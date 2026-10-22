import assert from "node:assert/strict";
import { pool, withTransaction } from "@/lib/inventory/db";
import { createProduct } from "@/lib/inventory/product-changes";
import { recordDelivery } from "@/lib/inventory/receipts";
import { recordPaidOrder } from "@/lib/inventory/orders";
import { adjust, breakDown, setLotStatus, transfer, writeOffLot, type AdjustInput } from "@/lib/inventory/operations";
import { listLots, listStock } from "@/lib/inventory/stock-reads";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);

export async function operationTests() {
  const biz = (await q(`insert into businesses(name) values('Ops Co') returning id`)).rows[0].id as string;
  const other = (await q(`insert into businesses(name) values('Ops Other') returning id`)).rows[0].id as string;
  await q(`insert into alert_settings(business_id) values($1),($2)`, [biz, other]);
  const loc = Object.fromEntries((await q(`select name,id from locations`)).rows.map((r) => [r.name, r.id])) as Record<string, string>;

  const product = await withTransaction((c) => createProduct(c, biz, "mgr1", {
    name: "Ops peptide", strengthSize: "10mg", category: "peptide", vialWeightG: null, isPriority: false,
    variants: [
      { packageType: "kit", sku: "OPS-KIT", homeLocationId: loc["Back 1"], minLevel: 0 },
      { packageType: "half_kit", sku: "OPS-HALF", homeLocationId: loc["Back 1"], minLevel: 0 },
      { packageType: "vial", sku: "OPS-VIAL", homeLocationId: loc["Rack A"], minLevel: 0 },
    ] }));
  const v = Object.fromEntries((await q(`select package_type, id from variants where product_id=$1`, [product])).rows.map((r) => [r.package_type, r.id])) as Record<string, string>;
  await withTransaction((c) => recordDelivery(c, "mgr1", { business_id: biz, reference: "OPS-1", received_at: "2026-09-01T00:00:00Z", lines: [
    { sku: "OPS-KIT", lot_number: "A1", quantity: 3 }, { sku: "OPS-HALF", lot_number: "A1", quantity: 1 }] }));
  const lotA = (await q(`select id from lots where product_id=$1 and lot_number='A1'`, [product])).rows[0].id as string;
  const qtyAt = async (variant: string, lot: string, location: string) =>
    (await q(`select coalesce(sum(quantity),0)::int n from stock where variant_id=$1 and lot_id=$2 and location_id=$3`, [variant, lot, location])).rows[0].n as number;
  const vialEq = async () =>
    (await q(`select sum(s.quantity*v.units_per_package)::int n from stock s join variants v on v.id=s.variant_id where v.product_id=$1`, [product])).rows[0].n as number;

  // ---- Lot status: first result needs no note; changing it later does; every change is kept ----
  assert.deepEqual(await withTransaction((c) => setLotStatus(c, biz, "mgr1", { lotId: lotA, status: "passed", note: null })), { changed: true, lot: "A1" });
  await assert.rejects(withTransaction((c) => setLotStatus(c, biz, "mgr1", { lotId: lotA, status: "failed", note: null })), /already marked Passed/);
  await assert.rejects(withTransaction((c) => setLotStatus(c, other, "mgr1", { lotId: lotA, status: "failed", note: "x" })), /isn't in this business/);
  assert.equal((await withTransaction((c) => setLotStatus(c, biz, "mgr1", { lotId: lotA, status: "passed", note: null }))).changed, false);
  assert.equal((await q(`select count(*)::int n from lot_status_changes where lot_id=$1`, [lotA])).rows[0].n, 1);

  // ---- Break down keeps the lot and the total vial equivalents ----
  const before = await vialEq();
  const r = await withTransaction((c) => breakDown(c, biz, "mgr1", { variantId: v.kit, lotId: lotA, fromLocationId: loc["Back 1"], toLocationId: loc["Rack C"], count: 1 }));
  assert.deepEqual(r, { vials: 10, to: "Rack C", lot: "A1" });
  assert.equal(await qtyAt(v.kit, lotA, loc["Back 1"]), 2);
  assert.equal(await qtyAt(v.vial, lotA, loc["Rack C"]), 10);
  assert.equal(await vialEq(), before);
  const bd = (await q(`select variant_id, from_location_id, to_location_id, quantity, group_id from movements where movement_type='break_down' and lot_id=$1 order by id`, [lotA])).rows;
  assert.equal(bd.length, 2);
  assert.equal(bd[0].group_id, bd[1].group_id, "one action, two linked movements");
  await withTransaction((c) => breakDown(c, biz, "mgr1", { variantId: v.half_kit, lotId: lotA, fromLocationId: loc["Back 1"], toLocationId: loc["Rack A"], count: 1 }));
  assert.equal(await qtyAt(v.vial, lotA, loc["Rack A"]), 5);
  await assert.rejects(
    withTransaction((c) => breakDown(c, biz, "mgr1", { variantId: v.half_kit, lotId: lotA, fromLocationId: loc["Back 1"], toLocationId: loc["Rack A"], count: 1 })),
    /no half kits of that lot at Back 1/
  );
  await assert.rejects(
    withTransaction((c) => breakDown(c, biz, "mgr1", { variantId: v.kit, lotId: lotA, fromLocationId: loc["Back 1"], toLocationId: loc["D6"], count: 1 })),
    /Rack A or Rack C/
  );
  await assert.rejects(
    withTransaction((c) => breakDown(c, biz, "mgr1", { variantId: v.vial, lotId: lotA, fromLocationId: loc["Rack A"], toLocationId: loc["Rack C"], count: 1 })),
    /Only kits and half kits/
  );
  // Two managers opening the last kits at once can't open more than exist
  const race = await Promise.allSettled([1, 2, 3].map(() =>
    withTransaction((c) => breakDown(c, biz, "mgr1", { variantId: v.kit, lotId: lotA, fromLocationId: loc["Back 1"], toLocationId: loc["Rack A"], count: 1 }))));
  assert.equal(race.filter((x) => x.status === "fulfilled").length, 2);
  assert.equal(await qtyAt(v.kit, lotA, loc["Back 1"]), 0);
  assert.equal(await vialEq(), before);

  // ---- Transfer ----
  await withTransaction((c) => transfer(c, biz, "mgr1", { variantId: v.vial, lotId: lotA, fromLocationId: loc["Rack A"], toLocationId: loc["D6"], quantity: 5 }));
  assert.equal(await qtyAt(v.vial, lotA, loc["D6"]), 5);
  await assert.rejects(
    withTransaction((c) => transfer(c, biz, "mgr1", { variantId: v.vial, lotId: lotA, fromLocationId: loc["D6"], toLocationId: loc["D3"], quantity: 6 })),
    /Only 5 vials of that lot at D6/
  );
  assert.equal(await qtyAt(v.vial, lotA, loc["D6"]), 5, "refused transfer changes nothing");
  await assert.rejects(
    withTransaction((c) => transfer(c, biz, "mgr1", { variantId: v.vial, lotId: lotA, fromLocationId: loc["D6"], toLocationId: loc["D6"], quantity: 1 })),
    /different location/
  );

  // ---- Adjustment ----
  const adj = (a: Partial<AdjustInput>) => withTransaction((c) => adjust(c, biz, "mgr2", {
    variantId: v.vial, lotId: lotA, locationId: loc["D6"], direction: "remove", quantity: 1, reason: "damaged", note: null, ...a }));
  await adj({});
  assert.equal(await qtyAt(v.vial, lotA, loc["D6"]), 4);
  await assert.rejects(adj({ quantity: 5 }), /Only 4 vials/);
  await assert.rejects(adj({ reason: "other" }), /Add a note/);
  await adj({ direction: "add", quantity: 2, reason: "other", note: "found behind the rack" });
  assert.equal(await qtyAt(v.vial, lotA, loc["D6"]), 6);
  const last = (await q(`select reason, notes, user_id, from_location_id, to_location_id from movements where movement_type='adjustment' order by id desc limit 1`)).rows[0];
  assert.deepEqual([last.reason, last.notes, last.user_id, last.from_location_id, last.to_location_id], ["other", "found behind the rack", "mgr2", null, loc["D6"]]);
  await assert.rejects(withTransaction((c) => adjust(c, other, "x", {
    variantId: v.vial, lotId: lotA, locationId: loc["D6"], direction: "add", quantity: 1, reason: "damaged", note: null })), /isn't in this business/);

  // ---- Failed lots: blocked from sale at once, written off on request ----
  await withTransaction((c) => setLotStatus(c, biz, "mgr1", { lotId: lotA, status: "failed", note: "Retest came back bad" }));
  const order = await withTransaction((c) => recordPaidOrder(c, biz, { order_ref: "OPS-ORDER", lines: [{ sku: "OPS-VIAL", quantity: 1 }] }));
  assert.equal(order.status, "needs_review", "failed stock is never sold");
  await assert.rejects(
    withTransaction((c) => breakDown(c, biz, "mgr1", { variantId: v.kit, lotId: lotA, fromLocationId: loc["Back 1"], toLocationId: loc["Rack C"], count: 1 })),
    /failed testing and can.t be broken down/
  );
  const units = await vialEq();
  const w = await withTransaction((c) => writeOffLot(c, biz, "mgr1", lotA));
  assert.deepEqual(w.removed, { vial: units });
  assert.equal(await vialEq(), 0);
  const wo = (await q(`select count(*)::int n, count(distinct group_id)::int g from movements where reason='failed_testing' and lot_id=$1`, [lotA])).rows[0];
  assert.equal(wo.g, 1);
  assert.ok(wo.n >= 2, "one movement per shelf line");
  await assert.rejects(withTransaction((c) => writeOffLot(c, biz, "mgr1", lotA)), /no stock left/);
  assert.deepEqual(
    (await q(`select from_status, to_status, note from lot_status_changes where lot_id=$1 order by id`, [lotA])).rows.map((x) => [x.from_status, x.to_status, x.note]),
    [["in_testing", "passed", null], ["passed", "failed", "Retest came back bad"]]
  );

  // ---- Reads: overdue after 40 days in testing (40 isn't overdue, 41 is) ----
  await withTransaction((c) => recordDelivery(c, "mgr1", { business_id: biz, reference: "OPS-2", lines: [
    { sku: "OPS-KIT", lot_number: "D40", quantity: 1 }, { sku: "OPS-KIT", lot_number: "D41", quantity: 1 }] }));
  await q(`update lots set received_at = now() - interval '40 days' - interval '1 hour' where lot_number='D40' and product_id=$1`, [product]);
  await q(`update lots set received_at = now() - interval '41 days' - interval '1 hour' where lot_number='D41' and product_id=$1`, [product]);
  const lots = await listLots(biz);
  const t = Object.fromEntries(lots.inTesting.map((l) => [l.lotNumber, [l.daysWaiting, l.overdue]]));
  assert.deepEqual(t, { D41: [41, true], D40: [40, false] });
  assert.deepEqual(lots.failed.map((l) => [l.lotNumber, l.units, l.lastNote]), [["A1", 0, "Retest came back bad"]]);
  assert.deepEqual((await listStock(biz, ["kit", "half_kit"])).map((s) => s.lotNumber), ["D41", "D40"], "oldest lot first");
  assert.deepEqual(await listStock(other), []);

  console.log("✓ operation tests passed");
}
