import assert from "node:assert/strict";
import { pool, withTransaction } from "@/lib/inventory/db";
import { createProduct } from "@/lib/inventory/product-changes";
import { recordDelivery } from "@/lib/inventory/receipts";
import { recordCancellation, recordPaidOrder } from "@/lib/inventory/orders";
import { breakDown, setLotStatus, writeOffLot } from "@/lib/inventory/operations";
import {
  getAlerts, listCancelledToReview, listOpenIssues, markCancelledReviewed, resolveIssue,
} from "@/lib/inventory/alerts";
import { listProducts } from "@/lib/inventory/products";
import { recentActivity } from "@/lib/inventory/activity";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);

export async function alertTests() {
  const biz = (await q(`insert into businesses(name) values('Alert Co') returning id`)).rows[0].id as string;
  const other = (await q(`insert into businesses(name) values('Alert Other') returning id`)).rows[0].id as string;
  await q(`insert into alert_settings(business_id) values($1),($2)`, [biz, other]);
  const loc = Object.fromEntries((await q(`select name,id from locations`)).rows.map((r) => [r.name, r.id])) as Record<string, string>;
  const deliver = (reference: string, lines: { sku: string; lot_number: string; quantity: number; location?: string }[]) =>
    withTransaction((c) => recordDelivery(c, "mgr1", { business_id: biz, reference, lines }));
  const pass = async (productId: string, lot: string) => {
    const id = (await q(`select id from lots where product_id=$1 and lot_number=$2`, [productId, lot])).rows[0].id;
    await withTransaction((c) => setLotStatus(c, biz, "mgr1", { lotId: id, status: "passed", note: null }));
    return id as string;
  };

  // ---- Days of cover: 900 units on hand, sales chosen to land on 59, 60, 89 and 90 days ----
  const cover: Record<number, string> = {};
  for (const [days, sold] of [[59, 912], [60, 900], [89, 604], [90, 600]] as const) {
    const pid = await withTransaction((c) => createProduct(c, biz, "mgr1", {
      name: `Cream ${days}`, strengthSize: null, category: "skin_care", vialWeightG: null, isPriority: true,
      variants: [{ packageType: "unit", sku: `CR${days}`, homeLocationId: loc["D6"], minLevel: 0 }] }));
    await deliver(`CR-${days}`, [{ sku: `CR${days}`, lot_number: "C1", quantity: 900 }]);
    const lot = await pass(pid, "C1");
    const v = (await q(`select id from variants where product_id=$1`, [pid])).rows[0].id;
    await q(`insert into movements(business_id,movement_type,variant_id,lot_id,from_location_id,quantity,created_at)
             values($1,'sold',$2,$3,$4,$5, now() - interval '5 days')`, [biz, v, lot, loc["D6"], sold]);
    cover[days] = pid;
  }
  const list = (await listProducts(biz, { priorityOnly: true })).products;
  const st = Object.fromEntries(list.map((p) => [p.name, [p.daysOfCover, p.status]]));
  assert.deepEqual(st, {
    "Cream 59": [59, "reorder"], "Cream 60": [60, "watch"], "Cream 89": [89, "watch"], "Cream 90": [90, "ok"],
  });
  let alerts = await getAlerts(biz);
  assert.deepEqual(alerts.cover.items.map((i) => i.name), ["Cream 59", "Cream 60", "Cream 89"], "below 90, most urgent first");
  assert.equal(alerts.cover.label, "Below 90-day cover");

  // ---- Refill (Rack A + Rack C together vs vial min level) and low stock (other forms) ----
  const pep = await withTransaction((c) => createProduct(c, biz, "mgr1", {
    name: "Refill pep", strengthSize: "5mg", category: "peptide", vialWeightG: null, isPriority: false,
    variants: [
      { packageType: "kit", sku: "RP-KIT", homeLocationId: loc["Back 1"], minLevel: 4 },
      { packageType: "vial", sku: "RP-VIAL", homeLocationId: loc["Rack A"], minLevel: 20 },
    ] }));
  await deliver("RP-1", [
    { sku: "RP-VIAL", lot_number: "R1", quantity: 12 }, { sku: "RP-VIAL", lot_number: "R1", quantity: 7, location: "Rack C" },
    { sku: "RP-VIAL", lot_number: "R1", quantity: 50, location: "D6" }, { sku: "RP-KIT", lot_number: "R1", quantity: 3 }]);
  const r1 = await pass(pep, "R1");
  await deliver("RP-2", [{ sku: "RP-VIAL", lot_number: "R2", quantity: 30 }, { sku: "RP-KIT", lot_number: "R2", quantity: 10 }]); // in testing: doesn't count
  alerts = await getAlerts(biz);
  assert.deepEqual(alerts.refill.items.map((i) => [i.name, i.info]), [["Refill pep 5mg", "Rack A 12 · Rack C 7 · 19 loose (min 20) · open a kit"]]);
  assert.match(alerts.refill.items[0].href, /\/break-down\?product=/);
  assert.deepEqual(alerts.low.items.map((i) => [i.name, i.info]), [["Refill pep 5mg", "3 kits (min 4)"]]);
  await deliver("RP-3", [{ sku: "RP-VIAL", lot_number: "R1", quantity: 1, location: "Rack C" }, { sku: "RP-KIT", lot_number: "R1", quantity: 1 }]);
  alerts = await getAlerts(biz);
  assert.equal(alerts.refill.items.length, 0, "20 loose = min level: no alert");
  assert.equal(alerts.low.items.length, 0, "4 kits = min level: no alert");

  // ---- Testing overdue: over 40 days ----
  await deliver("RP-4", [{ sku: "RP-KIT", lot_number: "T40", quantity: 1 }, { sku: "RP-KIT", lot_number: "T41", quantity: 1 }]);
  await q(`update lots set received_at = now() - interval '40 days 1 hour' where lot_number='T40' and product_id=$1`, [pep]);
  await q(`update lots set received_at = now() - interval '41 days 1 hour' where lot_number='T41' and product_id=$1`, [pep]);
  alerts = await getAlerts(biz);
  assert.deepEqual(alerts.testing.items.map((i) => i.info), ["Lot T41 · 41 days in testing"]);

  // ---- Count mismatch: off by more than 2 in a count finished in the last 7 days ----
  const kitV = (await q(`select id from variants where sku='RP-KIT' and business_id=$1`, [biz])).rows[0].id;
  const mkCount = async (finishedAgo: string, expected: number, counted: number, location: string) => {
    const sc = (await q(`insert into stock_counts(business_id,location_id,status,started_by,finished_by,finished_at)
                         values($1,$2,'finished','mgr1','mgr1', now() - $3::interval) returning id`, [biz, loc[location], finishedAgo])).rows[0].id;
    await q(`insert into stock_count_lines(stock_count_id,variant_id,lot_id,expected_qty,counted_qty) values($1,$2,$3,$4,$5)`, [sc, kitV, r1, expected, counted]);
  };
  await mkCount("1 day", 10, 8, "Back 1");   // off by 2: fine
  await mkCount("1 day", 10, 13, "D3");      // off by 3: alert
  await mkCount("8 days", 10, 1, "D2");      // too old
  alerts = await getAlerts(biz);
  assert.deepEqual(alerts.count.items.map((i) => i.info), ["D3 · lot R1 · expected 10 kits, counted 13"]);

  // ---- Cancelled orders to review ----
  await withTransaction((c) => recordPaidOrder(c, biz, { order_ref: "ORD-7", lines: [{ sku: "RP-VIAL", quantity: 3 }, { sku: "RP-KIT", quantity: 1 }] }));
  await withTransaction((c) => recordCancellation(c, biz, "ORD-7", "refunded"));
  let cancelled = await listCancelledToReview(biz);
  assert.deepEqual(cancelled.map((o) => [o.orderRef, o.type, o.items.sort()]), [["ORD-7", "refunded", ["Refill pep 5mg kit × 1", "Refill pep 5mg vial × 3"]]]);
  await assert.rejects(withTransaction((c) => markCancelledReviewed(c, other, "mgr1", cancelled[0].id)), /isn't in this business/);
  assert.deepEqual(await withTransaction((c) => markCancelledReviewed(c, biz, "mgr1", cancelled[0].id)), { orderRef: "ORD-7", already: false });
  cancelled = await listCancelledToReview(biz);
  assert.equal(cancelled.length, 0);
  assert.equal((await q(`select cancel_reviewed_by from inbound_orders where order_ref='ORD-7' and business_id=$1`, [biz])).rows[0].cancel_reviewed_by, "mgr1");

  // ---- Order issues ----
  await withTransaction((c) => recordPaidOrder(c, biz, { order_ref: "ORD-8", lines: [{ sku: "NOPE", quantity: 2 }, { sku: "RP-KIT", quantity: 99 }] }));
  let issues = await listOpenIssues(biz);
  assert.deepEqual(issues.map((i) => [i.orderRef, i.sku, i.issue, i.product]).sort(),
    [["ORD-8", "NOPE", "unknown_sku", null], ["ORD-8", "RP-KIT", "insufficient_stock", "Refill pep 5mg kit"]]);
  await assert.rejects(withTransaction((c) => resolveIssue(c, biz, "mgr1", issues[0].id, "  ")), /Add a note/);
  await assert.rejects(withTransaction((c) => resolveIssue(c, other, "mgr1", issues[0].id, "x")), /isn't in this business/);
  await withTransaction((c) => resolveIssue(c, biz, "mgr1", issues[0].id, "SKU fixed on the website"));
  issues = await listOpenIssues(biz);
  assert.equal(issues.length, 1);
  assert.deepEqual(await listOpenIssues(other), []);

  // ---- Recent activity: one line per action, newest first ----
  await deliver("RP-5", [{ sku: "RP-KIT", lot_number: "R1", quantity: 1 }]); // ORD-8 took every kit
  await withTransaction((c) => breakDown(c, biz, "mgr1", { variantId: kitV, lotId: r1, fromLocationId: loc["Back 1"], toLocationId: loc["Rack C"], count: 1 }));
  await withTransaction((c) => setLotStatus(c, biz, "mgr1", { lotId: r1, status: "failed", note: "Recall" }));
  await withTransaction((c) => writeOffLot(c, biz, "mgr1", r1));
  const act = await recentActivity(biz, 5);
  assert.equal(act.length, 5);
  assert.match(act[0].text, /^Wrote off lot R1 of Refill pep 5mg/);
  assert.match(act[1].text, /^Marked lot R1 \(Refill pep 5mg\) Failed · Recall/);
  assert.match(act[2].text, /^Broke down 1 kit of Refill pep 5mg · Back 1 → Rack C/);
  assert.ok(act.every((a, i) => i === 0 || a.at <= act[i - 1].at));
  assert.ok((await recentActivity(biz, 50)).some((a) => a.who === "Website" && /Order ORD-7/.test(a.text)));
  assert.deepEqual(await recentActivity(other), []);

  console.log("✓ alert tests passed");
}
