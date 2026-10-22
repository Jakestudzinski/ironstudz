import assert from "node:assert/strict";
import { pool, withTransaction } from "@/lib/inventory/db";
import { createProduct } from "@/lib/inventory/product-changes";
import { recordDelivery } from "@/lib/inventory/receipts";
import { recordPaidOrder } from "@/lib/inventory/orders";
import { setLotStatus, transfer } from "@/lib/inventory/operations";
import { addCountLine, cancelCount, finishCount, getCount, listCounts, saveCountLine, startCount } from "@/lib/inventory/counts";
import { getAlerts } from "@/lib/inventory/alerts";
import { allMovements, listMovementUsers, listMovements, movementsCsv } from "@/lib/inventory/movements";
import { parseCsv } from "@/lib/inventory/import";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);

export async function countTests() {
  const biz = (await q(`insert into businesses(name) values('Count Co') returning id`)).rows[0].id as string;
  const other = (await q(`insert into businesses(name) values('Count Other') returning id`)).rows[0].id as string;
  await q(`insert into alert_settings(business_id) values($1),($2)`, [biz, other]);
  const loc = Object.fromEntries((await q(`select name,id from locations`)).rows.map((r) => [r.name, r.id])) as Record<string, string>;
  const pid = await withTransaction((c) => createProduct(c, biz, "mgr1", {
    name: "Count pep", strengthSize: "10mg", category: "peptide", vialWeightG: 5.2, isPriority: false,
    variants: [
      { packageType: "kit", sku: "CP-KIT", homeLocationId: loc["Back 1"], minLevel: 0 },
      { packageType: "vial", sku: "CP-VIAL", homeLocationId: loc["Rack A"], minLevel: 0 },
    ] }));
  await withTransaction((c) => recordDelivery(c, "mgr1", { business_id: biz, reference: "CP-1", received_at: "2026-09-01T00:00:00Z", lines: [
    { sku: "CP-VIAL", lot_number: "V1", quantity: 30 }, { sku: "CP-VIAL", lot_number: "V2", quantity: 10 },
    { sku: "CP-KIT", lot_number: "V1", quantity: 5 }] }));
  const lot = async (n: string) => (await q(`select id from lots where product_id=$1 and lot_number=$2`, [pid, n])).rows[0].id as string;
  const v1 = await lot("V1"), v2 = await lot("V2");
  await withTransaction((c) => setLotStatus(c, biz, "mgr1", { lotId: v1, status: "passed", note: null }));
  const vialV = (await q(`select id from variants where sku='CP-VIAL' and business_id=$1`, [biz])).rows[0].id as string;
  const shelf = async (lotId: string, location = "Rack A") =>
    (await q(`select coalesce(sum(quantity),0)::int n from stock where variant_id=$1 and lot_id=$2 and location_id=$3`, [vialV, lotId, loc[location]])).rows[0].n as number;

  // ---- Start: one open count per location, lists what's on the shelf ----
  const s = await withTransaction((c) => startCount(c, biz, "mgr1", loc["Rack A"]));
  assert.deepEqual([s.lines, s.location], [2, "Rack A"]);
  await assert.rejects(withTransaction((c) => startCount(c, biz, "mgr2", loc["Rack A"])), /already open at Rack A/);
  const other1 = await withTransaction((c) => startCount(c, other, "x", loc["Rack A"]));
  assert.ok(other1.countId, "another business can count the same shared location");
  assert.equal(await getCount(other, s.countId), null, "no cross-business access");

  let count = (await getCount(biz, s.countId))!;
  const line = (lotNumber: string) => count.lines.find((l) => l.lotNumber === lotNumber)!;
  assert.deepEqual(count.lines.map((l) => [l.lotNumber, l.expected, l.counted, l.vialWeightG]), [["V1", 30, null, 5.2], ["V2", 10, null, 5.2]]);

  // ---- Count by weight: 135.2 g ÷ 5.2 g = 26 vials; 137 g is 26.35 → 26 with a recount warning ----
  assert.deepEqual(await withTransaction((c) => saveCountLine(c, biz, s.countId, line("V1").id, { counted: null, weightG: 135.2 })),
    { counted: 26, exact: 26, recount: false });
  assert.deepEqual(await withTransaction((c) => saveCountLine(c, biz, s.countId, line("V1").id, { counted: null, weightG: 137 })),
    { counted: 26, exact: 26.35, recount: true });
  count = (await getCount(biz, s.countId))!;
  assert.deepEqual([line("V1").counted, line("V1").countedWeightG], [26, 137]);
  await assert.rejects(withTransaction((c) => saveCountLine(c, biz, s.countId, line("V1").id, { counted: -1, weightG: null })), /whole numbers/);

  // Found stock that wasn't expected here: lot V2 kits on Rack A
  const kitV = (await q(`select id from variants where sku='CP-KIT' and business_id=$1`, [biz])).rows[0].id as string;
  const added = await withTransaction((c) => addCountLine(c, biz, s.countId, kitV, v2));
  await assert.rejects(withTransaction((c) => addCountLine(c, biz, s.countId, kitV, v2)), /already on this count/);
  await withTransaction((c) => saveCountLine(c, biz, s.countId, added.lineId, { counted: 2, weightG: null }));
  await assert.rejects(
    withTransaction((c) => saveCountLine(c, biz, s.countId, added.lineId, { counted: null, weightG: 10 })),
    /Only loose vials can be counted by weight/
  );

  // ---- While the count is open, an order takes 3 vials of V1 from Rack A ----
  await withTransaction((c) => recordPaidOrder(c, biz, { order_ref: "CNT-ORD", lines: [{ sku: "CP-VIAL", quantity: 3 }] }));
  count = (await getCount(biz, s.countId))!;
  assert.deepEqual([line("V1").expected, line("V1").current], [30, 27], "lines that moved during the count show both");

  // ---- Finish: V1 counted 26 vs 27 now → −1; kits found 2 → +2; V2 left blank → skipped ----
  const done = await withTransaction((c) => finishCount(c, biz, "mgr2", s.countId));
  assert.deepEqual(done, { location: "Rack A", counted: 2, skipped: 1, corrections: 2 });
  assert.equal(await shelf(v1), 26);
  assert.equal(await shelf(v2), 10, "blank line left unchanged");
  assert.equal((await q(`select quantity from stock where variant_id=$1 and lot_id=$2 and location_id=$3`, [kitV, v2, loc["Rack A"]])).rows[0].quantity, 2);
  const adj = (await q(`select quantity, from_location_id is not null as removed, reason, group_id, user_id, notes
                         from movements where group_id=$1 order by quantity`, [s.countId])).rows;
  assert.deepEqual(adj.map((a) => [a.quantity, a.removed, a.reason, a.user_id, a.notes]),
    [[1, true, "count_correction", "mgr2", "Stock count at Rack A"], [2, false, "count_correction", "mgr2", "Stock count at Rack A"]]);
  await assert.rejects(withTransaction((c) => saveCountLine(c, biz, s.countId, line("V2").id, { counted: 1, weightG: null })), /already finished/);
  await assert.rejects(withTransaction((c) => finishCount(c, biz, "mgr2", s.countId)), /already finished/);

  // The count mismatch alert uses the threshold (2): off by 1 and 2 aren't flagged
  assert.equal((await getAlerts(biz)).count.items.length, 0);
  const s2 = await withTransaction((c) => startCount(c, biz, "mgr1", loc["Rack A"]));
  const c2 = (await getCount(biz, s2.countId))!;
  await withTransaction((c) => saveCountLine(c, biz, s2.countId, c2.lines.find((l) => l.lotNumber === "V1")!.id, { counted: 20, weightG: null }));
  await withTransaction((c) => finishCount(c, biz, "mgr1", s2.countId));
  assert.deepEqual((await getAlerts(biz)).count.items.map((i) => i.info), ["Rack A · lot V1 · expected 26 vials, counted 20"]);

  // Cancel leaves stock alone; a new count can then start
  const s3 = await withTransaction((c) => startCount(c, biz, "mgr1", loc["Back 1"]));
  await withTransaction((c) => cancelCount(c, biz, "mgr1", s3.countId));
  await withTransaction((c) => startCount(c, biz, "mgr1", loc["Back 1"]));
  assert.deepEqual((await listCounts(biz)).map((x) => [x.location, x.status]),
    [["Back 1", "open"], ["Back 1", "cancelled"], ["Rack A", "finished"], ["Rack A", "finished"]]);

  // ---- Movement history ----
  await withTransaction((c) => transfer(c, biz, "mgr2", { variantId: vialV, lotId: v1, fromLocationId: loc["Rack A"], toLocationId: loc["D6"], quantity: 1 }));
  const all = await listMovements(biz, {});
  assert.equal(all.total, (await q(`select count(*)::int n from movements where business_id=$1`, [biz])).rows[0].n);
  assert.deepEqual((await listMovements(biz, { type: "sold" })).rows.map((r) => [r.orderRef, r.who, r.change]), [["CNT-ORD", "Website", -3]]);
  assert.deepEqual((await listMovements(biz, { who: "website" })).rows.map((r) => r.type), ["sold"]);
  assert.deepEqual((await listMovements(biz, { who: "mgr2", type: "transfer" })).rows.map((r) => [r.from, r.to, r.change]), [["Rack A", "D6", 0]]);
  assert.equal((await listMovements(biz, { orderRef: "cnt-o" })).total, 1);
  assert.equal((await listMovements(biz, { productId: pid })).total, all.total);
  assert.equal((await listMovements(other, {})).total, 0);
  // Phoenix days: a movement at 06:30 UTC on Oct 2 is still Oct 1 in Phoenix (UTC−7)
  await q(`update movements set created_at='2026-10-02T06:30:00Z' where order_ref='CNT-ORD' and business_id=$1`, [biz]);
  assert.equal((await listMovements(biz, { from: "2026-10-01", to: "2026-10-01" })).total, 1);
  assert.equal((await listMovements(biz, { from: "2026-10-02", to: "2026-10-02" })).total, 0);
  assert.deepEqual((await listMovementUsers(biz)).map((u) => u.id), ["mgr1", "mgr2"]);

  // CSV: one row per movement, oldest first, Phoenix times, safe against spreadsheet formulas
  await q(`update movements set notes='=HYPERLINK("x"), "quoted"' where group_id=$1 and quantity=2`, [s.countId]);
  const csv = movementsCsv(await allMovements(biz, {}));
  const table = parseCsv(csv);
  assert.equal(table[0][0], "Date (Phoenix)");
  assert.equal(table.length - 1, all.total);
  assert.ok(table.some((r) => r[11] === "CNT-ORD" && r[0] === "2026-10-01 23:30" && r[9] === "-3"));
  assert.ok(table.some((r) => r[13] === `'=HYPERLINK("x"), "quoted"`), "formula-looking text is neutralised");

  console.log("✓ count and movement tests passed");
}
