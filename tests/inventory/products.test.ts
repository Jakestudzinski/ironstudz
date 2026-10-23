import assert from "node:assert/strict";
import { pool, withRollback, withTransaction } from "@/lib/inventory/db";
import { getProductDetail, listProducts } from "@/lib/inventory/products";
import {
  addVariant, createProduct, setMinLevel, setPriority, setProductActive, updateProduct, updateVariant,
  type NewProductInput,
} from "@/lib/inventory/product-changes";
import { parseCsv, runImport } from "@/lib/inventory/import";
import { recordDelivery } from "@/lib/inventory/receipts";
import { formatInTesting, formatMix } from "@/lib/inventory/product-meta";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);
const tx = <T>(fn: Parameters<typeof withTransaction<T>>[0]) => withTransaction(fn);

export async function productTests() {
  const biz = (await q(`insert into businesses(name) values('Prod A') returning id`)).rows[0].id as string;
  const other = (await q(`insert into businesses(name) values('Prod B') returning id`)).rows[0].id as string;
  await q(`insert into alert_settings(business_id) values($1),($2)`, [biz, other]);
  const loc = Object.fromEntries((await q(`select name,id from locations`)).rows.map((r) => [r.name, r.id]));

  const peptide = (name: string, prefix: string, extra: Partial<NewProductInput> = {}): NewProductInput => ({
    name, strengthSize: "10mg", category: "peptide", vialWeightG: null, isPriority: false,
    variants: [
      { packageType: "kit", sku: `${prefix}-KIT`, homeLocationId: loc["Back 1"], minLevel: 4 },
      { packageType: "half_kit", sku: `${prefix}-HALF`, homeLocationId: loc["Back 1"], minLevel: 2 },
      { packageType: "vial", sku: `${prefix}-VIAL`, homeLocationId: loc["Rack A"], minLevel: 20 },
    ],
    ...extra,
  });

  // ---- Create, with the rules on forms and SKUs ----
  const bpc = await tx((c) => createProduct(c, biz, "mgr1", peptide("BPC-157", "BPC", { vialWeightG: 5.25, isPriority: true })));
  await assert.rejects(tx((c) => createProduct(c, biz, "mgr1", peptide("Other", "BPC"))), /already used by BPC-157 10mg/);
  await assert.rejects(
    tx((c) => createProduct(c, biz, "mgr1", { ...peptide("Serum", "S"), category: "skin_care" })),
    /Skin care products can't be sold as "Kit/
  );
  await assert.rejects(
    tx((c) => createProduct(c, biz, "mgr1", { ...peptide("Dup", "D"), variants: [
      { packageType: "kit", sku: "D1", homeLocationId: null, minLevel: 0 },
      { packageType: "kit", sku: "D2", homeLocationId: null, minLevel: 0 }] })),
    /listed twice/
  );
  assert.equal((await q(`select count(*)::int n from products where business_id=$1`, [biz])).rows[0].n, 1, "failed creates leave nothing");
  // Same SKU is fine in another business
  const otherProduct = await tx((c) => createProduct(c, other, "mgr2", peptide("BPC-157", "BPC")));

  // ---- Stock mix, days of cover and status ----
  await tx((c) => recordDelivery(c, "mgr1", { business_id: biz, reference: "P-DEL1", received_at: "2026-08-01T00:00:00Z", lines: [
    { sku: "BPC-KIT", lot_number: "L1", quantity: 48 }, { sku: "BPC-HALF", lot_number: "L1", quantity: 6 },
    { sku: "BPC-VIAL", lot_number: "L1", quantity: 18 }, { sku: "BPC-VIAL", lot_number: "L1", quantity: 12, location: "Rack C" }] }));
  await tx((c) => recordDelivery(c, "mgr1", { business_id: biz, reference: "P-DEL2", lines: [{ sku: "BPC-KIT", lot_number: "L2", quantity: 30 }] }));
  await q(`update lots set testing_status='passed' where lot_number='L1' and product_id=$1`, [bpc]);
  // 312 vial equivalents sold in the 60-day window = 5.2/day; one sale older than the window is ignored
  const vial = (await q(`select id from variants where sku='BPC-VIAL' and business_id=$1`, [biz])).rows[0].id;
  const l1 = (await q(`select id from lots where lot_number='L1' and product_id=$1`, [bpc])).rows[0].id;
  await q(`insert into movements(business_id,movement_type,variant_id,lot_id,from_location_id,quantity,order_ref,created_at)
           values ($1,'sold',$2,$3,$4,312,'OLD-SALES', now() - interval '10 days'),
                  ($1,'sold',$2,$3,$4,999,'ANCIENT', now() - interval '90 days')`, [biz, vial, l1, loc["Rack A"]]);

  const list = await listProducts(biz);
  assert.equal(list.products.length, 1);
  const row = list.products[0];
  assert.equal(formatMix(row.sellable, row.forms), "48 kits · 6 half · 30 vials");
  assert.equal(formatInTesting(row.inTesting), "+30 kits");
  assert.equal(row.total, 540);
  assert.equal(row.salesPerDay, 5.2);
  assert.equal(row.daysOfCover, 103);
  assert.equal(row.status, "ok");
  assert.deepEqual([list.active, list.priority], [1, 1]);

  // Status boundaries come from cover_days (90) and 60
  await q(`update alert_settings set cover_days=104 where business_id=$1`, [biz]);
  assert.equal((await listProducts(biz)).products[0].status, "watch");
  await q(`update alert_settings set cover_days=90 where business_id=$1`, [biz]);

  // ---- Filters and search ----
  const serum = await tx((c) => createProduct(c, biz, "mgr1", {
    name: "Copper peptide serum", strengthSize: "30ml", category: "skin_care", vialWeightG: null, isPriority: false,
    variants: [{ packageType: "unit", sku: "SERUM-30", homeLocationId: loc["D6"], minLevel: 10 }] }));
  assert.deepEqual((await listProducts(biz, { search: "serum-3" })).products.map((p) => p.name), ["Copper peptide serum"], "search by SKU");
  assert.deepEqual((await listProducts(biz, { search: "bpc-157 10" })).products.map((p) => p.name), ["BPC-157"], "search name + strength");
  assert.deepEqual((await listProducts(biz, { category: "skin_care" })).products.map((p) => p.name), ["Copper peptide serum"]);
  assert.deepEqual((await listProducts(biz, { priorityOnly: true })).products.map((p) => p.name), ["BPC-157"]);
  assert.deepEqual((await listProducts(biz, { locationId: loc["Rack C"] })).products.map((p) => p.name), ["BPC-157"]);
  assert.equal((await listProducts(biz)).products.find((p) => p.id === serum)!.status, "no_sales");
  assert.deepEqual((await listProducts(biz, { sort: "total" })).products.map((p) => p.name), ["BPC-157", "Copper peptide serum"]);

  // ---- Detail ----
  const d = (await getProductDetail(biz, bpc))!;
  assert.deepEqual([d.sellable, d.inTesting, d.salesPerDay, d.daysOfCover], [540, 300, 5.2, 103]);
  assert.equal(d.stock.length, 5);
  assert.deepEqual(d.variants.map((v) => [v.sku, v.onHand]), [["BPC-KIT", 48], ["BPC-HALF", 6], ["BPC-VIAL", 30]]);
  assert.equal(d.history[0].type, "received", "newest first");
  const sale = d.history.find((h) => h.orderRef === "OLD-SALES")!;
  assert.equal(sale.who, null, "website sales have no user");
  assert.equal(await getProductDetail(other, bpc), null, "no cross-business access");
  assert.equal(await getProductDetail(biz, otherProduct), null);

  // ---- Edits ----
  await tx((c) => updateProduct(c, biz, "mgr1", bpc, { name: "BPC-157", strengthSize: "10mg", category: "peptide", vialWeightG: 5.3 }));
  assert.equal((await q(`select vial_weight_g::float8 w from products where id=$1`, [bpc])).rows[0].w, 5.3);
  await assert.rejects(
    tx((c) => updateProduct(c, biz, "mgr1", bpc, { name: "BPC-157", strengthSize: "10mg", category: "skin_care", vialWeightG: null })),
    /can't have a "Kit/
  );
  const kitId = d.variants[0].id;
  await assert.rejects(
    tx((c) => updateVariant(c, biz, kitId, { sku: "SERUM-30", homeLocationId: null, minLevel: 1, isActive: true })),
    /already used by Copper peptide serum/
  );
  await tx((c) => updateVariant(c, biz, kitId, { sku: "BPC-KIT2", homeLocationId: loc["D2"], minLevel: 7, isActive: true }));
  await tx((c) => setMinLevel(c, biz, kitId, 9));
  assert.deepEqual((await q(`select sku, min_level from variants where id=$1`, [kitId])).rows[0], { sku: "BPC-KIT2", min_level: 9 });
  await assert.rejects(tx((c) => setMinLevel(c, other, kitId, 1)), /isn't in this business/);
  await assert.rejects(tx((c) => addVariant(c, biz, serum, { packageType: "unit", sku: "SERUM-2", homeLocationId: null, minLevel: 0 })), /listed twice/);

  await tx((c) => setProductActive(c, biz, serum, false));
  assert.deepEqual((await listProducts(biz)).products.map((p) => p.name), ["BPC-157"]);
  assert.equal((await listProducts(biz, { includeInactive: true })).products.length, 2);
  await tx((c) => setProductActive(c, biz, serum, true));

  // ---- Priority is capped at 15 ----
  const ids: string[] = [];
  for (let i = 1; i <= 14; i++) {
    ids.push(await tx((c) => createProduct(c, biz, "mgr1", { ...peptide(`Pri ${String(i).padStart(2, "0")}`, `PRI${i}`), isPriority: true })));
  }
  assert.equal((await listProducts(biz)).priority, 15);
  await assert.rejects(tx((c) => setPriority(c, biz, serum, true)), /already 15 priority products/);
  await assert.rejects(
    tx((c) => createProduct(c, biz, "mgr1", { ...peptide("Pri 16", "PRI16"), isPriority: true })),
    /already 15 priority/
  );
  await tx((c) => setPriority(c, biz, bpc, true)); // already priority: no change, allowed
  // Two managers racing for the last slot: only one wins
  await tx((c) => setPriority(c, biz, ids[0], false));
  const race = await Promise.allSettled([tx((c) => setPriority(c, biz, serum, true)), tx((c) => setPriority(c, biz, ids[0], true))]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await listProducts(biz)).priority, 15);

  console.log("✓ product tests passed");
  return { biz, loc };
}

export async function importTests() {
  const biz = (await q(`insert into businesses(name) values('Import Co') returning id`)).rows[0].id as string;
  await q(`insert into alert_settings(business_id) values($1)`, [biz]);
  const count = async () => (await q(`select count(*)::int n from variants where business_id=$1`, [biz])).rows[0].n;

  // CSV reader: quotes, embedded commas, Excel BOM, CRLF, blank lines
  assert.deepEqual(parseCsv('﻿a,"b, c","say ""hi"""\r\n\r\n1,2,3\n'), [["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);

  const good = [
    "sku,product,strength,category,form,home_location,min_level,priority,vial_weight_g,active",
    "TB-KIT,TB-500,10mg,peptide,kit,Back 1,4,yes,5.18,yes",
    "TB-VIAL,TB-500,10mg,peptide,Vial,rack a,20,,,",
    "NIGHT-50,Peptide night cream,50ml,Skin care,unit,D6,5,no,,",
  ].join("\n");

  // Preview writes nothing and reports what would happen
  const preview = await withRollback((c) => runImport(c, biz, "mgr1", good, false));
  assert.deepEqual(preview.counts, { newProducts: 2, newForms: 1, updates: 0, errors: 0 });
  assert.deepEqual(preview.rows.map((r) => r.action), ["new_product", "new_form", "new_product"]);
  assert.equal(await count(), 0, "preview must not write");

  // Import does exactly what the preview said
  const done = await withTransaction((c) => runImport(c, biz, "mgr1", good, true));
  assert.deepEqual(done.counts, preview.counts);
  assert.equal(await count(), 3);
  const tb = (await q(`select id, is_priority, vial_weight_g::float8 w from products where name='TB-500' and business_id=$1`, [biz])).rows[0];
  assert.deepEqual([tb.is_priority, tb.w], [true, 5.18]);
  assert.equal((await q(`select l.name from variants v join locations l on l.id=v.home_location_id where v.sku='TB-VIAL'`)).rows[0].name, "Rack A");

  // Re-importing with changes updates by SKU; blank cells leave values alone
  const again = "sku,product,strength,category,form,min_level,priority\nTB-KIT,TB-500,10mg,peptide,kit,8,\nTB-HALF,tb-500,10MG,peptide,half kit,2,";
  const r2 = await withTransaction((c) => runImport(c, biz, "mgr1", again, true));
  assert.deepEqual(r2.counts, { newProducts: 0, newForms: 1, updates: 1, errors: 0 });
  const kit = (await q(`select min_level, home_location_id from variants where sku='TB-KIT' and business_id=$1`, [biz])).rows[0];
  assert.equal(kit.min_level, 8);
  assert.ok(kit.home_location_id, "blank home_location keeps the existing one");
  assert.equal((await q(`select is_priority from products where id=$1`, [tb.id])).rows[0].is_priority, true);

  // Any error: nothing is imported, and every problem row is reported with its line number
  const broken = [
    "sku,product,strength,category,form,home_location,min_level,priority",
    "NEW-1,New thing,5mg,peptide,kit,Back 1,1,",
    "NEW-1,New thing,5mg,peptide,vial,,,",
    "BAD-FORM,Lotion,,skin care,kit,,,",
    "TB-VIAL,Someone else,5mg,peptide,vial,,,",
    "X-2,Thing,,peptide,flask,Garage,-1,maybe",
  ].join("\n");
  const before = await count();
  const p3 = await withRollback((c) => runImport(c, biz, "mgr1", broken, false));
  assert.deepEqual(p3.rows.map((r) => [r.line, r.action]), [[2, "new_product"], [3, "error"], [4, "error"], [5, "error"], [6, "error"]]);
  assert.match(p3.rows[1].errors[0], /also on line 2/);
  assert.match(p3.rows[2].errors[0], /can't be sold as "Kit/);
  assert.match(p3.rows[3].errors[0], /belongs to TB-500 10mg/);
  assert.equal(p3.rows[4].errors.length, 4, "form, location, min level and priority all reported");
  await assert.rejects(withTransaction((c) => runImport(c, biz, "mgr1", broken, true)), /Nothing was imported/);
  assert.equal(await count(), before);

  // Missing columns and the priority cap are file-level errors
  const noCols = await withRollback((c) => runImport(c, biz, "mgr1", "sku,product\nA,B", false));
  assert.match(noCols.fileErrors[0], /Missing columns: category, form/);
  const many = ["sku,product,strength,category,form,priority",
    ...Array.from({ length: 15 }, (_, i) => `P${i},Prio ${i},,peptide,kit,yes`)].join("\n");
  const capped = await withRollback((c) => runImport(c, biz, "mgr1", many, false));
  assert.match(capped.fileErrors[0], /16 priority products; the limit is 15/);
  await assert.rejects(withTransaction((c) => runImport(c, biz, "mgr1", many, true)), /Nothing was imported/);

  console.log("✓ import tests passed");
}
