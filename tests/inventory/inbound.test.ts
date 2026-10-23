import assert from "node:assert/strict";
import { pool, withTransaction } from "@/lib/inventory/db";
import { generateApiKey, hashApiKey } from "@/lib/inventory/auth";
import { recordDelivery } from "@/lib/inventory/receipts";
import { POST as postOrder } from "@/app/api/inventory/inbound/orders/route";
import { POST as postCancel } from "@/app/api/inventory/inbound/orders/[order]/cancel/route";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);
type Deducted = { location_id: string; quantity: number };
type Issue = { issue: string; deducted: number };
// The route handlers under test: (request) or (request, { params })
type Handler = (req: Request, ctx: { params: Promise<{ order: string }> }) => Promise<Response>;
const call = (fn: Handler, key: string | null, body: unknown, params?: { params: Promise<{ order: string }> }) =>
  fn(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}) }, body: JSON.stringify(body) }), params as { params: Promise<{ order: string }> });

async function main() {
  const b1 = (await q(`insert into businesses(name) values('Biz One') returning id`)).rows[0].id;
  const b2 = (await q(`insert into businesses(name) values('Biz Two') returning id`)).rows[0].id;
  const key1 = generateApiKey(), key2 = generateApiKey();
  await q(`insert into api_keys(business_id,key_hash,label) values($1,$2,'site'),($3,$4,'site')`, [b1, hashApiKey(key1), b2, hashApiKey(key2)]);
  const loc = Object.fromEntries((await q(`select name,id from locations`)).rows.map((r) => [r.name, r.id]));
  const p = (await q(`insert into products(business_id,name,category,strength_size) values($1,'BPC-157','peptide','10mg') returning id`, [b1])).rows[0].id;
  const vial = (await q(`insert into variants(business_id,product_id,package_type,units_per_package,sku,home_location_id) values($1,$2,'vial',1,'BPC10-V',$3) returning id`, [b1, p, loc["Rack A"]])).rows[0].id;
  await q(`insert into variants(business_id,product_id,package_type,units_per_package,sku,home_location_id) values($1,$2,'kit',10,'BPC10-K',$3)`, [b1, p, loc["Back 1"]]);

  // Deliveries: older lot L1 (5 at Rack A, 3 at Rack C), newer L2 (10), plus a kit lot in testing
  await withTransaction((c) => recordDelivery(c, "mgr1", { business_id: b1, reference: "DEL-1", received_at: "2026-09-01T10:00:00Z", lines: [
    { sku: "BPC10-V", lot_number: "L1", quantity: 5 }, { sku: "BPC10-V", lot_number: "L1", quantity: 3, location: "Rack C" } ] }));
  const dup = await withTransaction((c) => recordDelivery(c, "mgr1", { business_id: b1, reference: "DEL-1", lines: [{ sku: "BPC10-V", lot_number: "L1", quantity: 99 }] }));
  assert.equal(dup.duplicate, true);
  await withTransaction((c) => recordDelivery(c, "mgr1", { business_id: b1, reference: "DEL-2", received_at: "2026-10-01T10:00:00Z", lines: [{ sku: "BPC10-V", lot_number: "L2", quantity: 10 }] }));
  await assert.rejects(withTransaction((c) => recordDelivery(c, "mgr1", { business_id: b1, reference: "DEL-3", lines: [{ sku: "NOPE", lot_number: "X", quantity: 1 }] })));
  assert.equal((await q(`select count(*)::int n from receipts where reference='DEL-3'`)).rows[0].n, 0, "rejected delivery must leave nothing behind");

  assert.equal((await q(`select testing_status from lots where lot_number='L1'`)).rows[0].testing_status, "in_testing");

  // Nothing passed yet -> order flagged, nothing deducted
  let r = await (await call(postOrder, key1, { order_ref: "O-1", lines: [{ sku: "BPC10-V", quantity: 2 }] })).json();
  assert.equal(r.status, "needs_review"); assert.equal(r.deducted.length, 0);

  await q(`update lots set testing_status='passed'`);
  // FIFO: 7 vials -> L1 Rack A (home) 5, then L1 Rack C 2
  r = await (await call(postOrder, key1, { order_ref: "O-2", lines: [{ sku: "BPC10-V", quantity: 4 }, { sku: "BPC10-V", quantity: 3 }] })).json();
  assert.equal(r.status, "processed");
  assert.deepEqual(r.deducted.map((d: Deducted) => [d.location_id === loc["Rack A"] ? "A" : "C", d.quantity]), [["A", 5], ["C", 2]]);
  // Duplicate order: no second deduction
  r = await (await call(postOrder, key1, { order_ref: "O-2", lines: [{ sku: "BPC10-V", quantity: 7 }] })).json();
  assert.equal(r.duplicate, true);
  // 12 requested, 11 left (1 in L1, 10 in L2) + unknown sku
  r = await (await call(postOrder, key1, { order_ref: "O-3", lines: [{ sku: "BPC10-V", quantity: 12 }, { sku: "GHOST", quantity: 1 }] })).json();
  assert.equal(r.status, "needs_review");
  assert.deepEqual(r.issues.map((i: Issue) => [i.issue, i.deducted]).sort(), [["insufficient_stock", 11], ["unknown_sku", 0]]);
  assert.equal((await q(`select coalesce(sum(quantity),0)::int n from stock where variant_id=$1`, [vial])).rows[0].n, 0);
  assert.equal((await q(`select min(quantity)::int n from stock`)).rows[0].n, 0, "never negative");

  // Business isolation: Biz Two's key can't see Biz One's SKU
  r = await (await call(postOrder, key2, { order_ref: "O-2", lines: [{ sku: "BPC10-V", quantity: 1 }] })).json();
  assert.equal(r.issues[0].issue, "unknown_sku");

  // Auth + validation
  assert.equal((await call(postOrder, null, { order_ref: "x", lines: [] })).status, 401);
  assert.equal((await call(postOrder, "inv_wrong", { order_ref: "x", lines: [] })).status, 401);
  assert.equal((await call(postOrder, key1, { order_ref: "x", lines: [] })).status, 400);

  // Cancellation
  const params = (o: string) => ({ params: Promise.resolve({ order: o }) });
  const res = await call(postCancel, key1, { type: "refunded" }, params("O-2"));
  r = await res.json(); assert.equal(res.status, 200); assert.equal(r.duplicate, false);
  r = await (await call(postCancel, key1, {}, params("O-2"))).json(); assert.equal(r.duplicate, true);
  assert.equal((await call(postCancel, key1, {}, params("NOPE"))).status, 404);
  assert.equal((await q(`select coalesce(sum(quantity),0)::int n from stock where variant_id=$1`, [vial])).rows[0].n, 0, "cancel does not restock");

  // Concurrency: two orders racing for the last 5 units
  await withTransaction((c) => recordDelivery(c, "mgr1", { business_id: b1, reference: "DEL-4", lines: [{ sku: "BPC10-V", lot_number: "L3", quantity: 5 }] }));
  await q(`update lots set testing_status='passed' where lot_number='L3'`);
  const [a, b] = await Promise.all([
    call(postOrder, key1, { order_ref: "R-1", lines: [{ sku: "BPC10-V", quantity: 4 }] }).then((x: Response) => x.json()),
    call(postOrder, key1, { order_ref: "R-2", lines: [{ sku: "BPC10-V", quantity: 4 }] }).then((x: Response) => x.json()),
  ]);
  const total = [a, b].flatMap((x) => x.deducted).reduce((s: number, d: Deducted) => s + d.quantity, 0);
  assert.equal(total, 5, "race must never oversell");

  const logs = (await q(`select count(*)::int n from inbound_requests`)).rows[0].n;
  console.log("ALL TESTS PASSED · requests logged:", logs);
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
