import assert from "node:assert/strict";
import { pool } from "@/lib/inventory/db";
import { listManagedBusinesses, resolveActiveBusiness, setActiveBusiness } from "@/lib/inventory/businesses";
import { getSummaryCounts } from "@/lib/inventory/summary";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);

export async function foundationTests() {
  const a = (await q(`insert into businesses(name) values('Alpha Peptides') returning id`)).rows[0].id;
  const b = (await q(`insert into businesses(name) values('Beta Skin') returning id`)).rows[0].id;
  const c = (await q(`insert into businesses(name, is_active) values('Closed Co', false) returning id`)).rows[0].id;
  await q(`insert into business_users values ($1,'mgr1'),($2,'mgr1'),($3,'mgr1'),($2,'mgr2')`, [a, b, c]);

  // Only active businesses the user manages, sorted
  assert.deepEqual((await listManagedBusinesses("mgr1")).map((x) => x.name), ["Alpha Peptides", "Beta Skin"]);
  assert.deepEqual((await listManagedBusinesses("mgr2")).map((x) => x.name), ["Beta Skin"]);
  assert.deepEqual(await listManagedBusinesses("stranger"), []);

  // Default = first business; preference respected; stale preference falls back
  const m1 = await listManagedBusinesses("mgr1");
  assert.equal((await resolveActiveBusiness("mgr1", m1))!.name, "Alpha Peptides");
  assert.equal(await setActiveBusiness("mgr1", b), true);
  assert.equal((await resolveActiveBusiness("mgr1", m1))!.name, "Beta Skin");
  assert.equal(await resolveActiveBusiness("stranger", []), null);

  // Can't switch into a business you don't manage, or an inactive one
  assert.equal(await setActiveBusiness("mgr2", a), false);
  assert.equal(await setActiveBusiness("mgr1", c), false);
  assert.equal((await q(`select count(*)::int n from user_preferences where user_id='mgr2'`)).rows[0].n, 0);

  // Business removed from a manager -> falls back to one they still manage
  await q(`delete from business_users where business_id=$1 and user_id='mgr1'`, [b]);
  const m1b = await listManagedBusinesses("mgr1");
  assert.equal((await resolveActiveBusiness("mgr1", m1b))!.name, "Alpha Peptides");
  await q(`insert into business_users values ($1,'mgr1')`, [b]);

  // Summary counts: only Passed stock counts as sellable, in vial equivalents, per business
  const loc = (await q(`select id from locations where name='Back 1'`)).rows[0].id;
  const p = (await q(`insert into products(business_id,name,category,is_priority) values($1,'BPC-157','peptide',true) returning id`, [a])).rows[0].id;
  const kit = (await q(`insert into variants(business_id,product_id,package_type,units_per_package,sku) values($1,$2,'kit',10,'K') returning id`, [a, p])).rows[0].id;
  const passed = (await q(`insert into lots(product_id,lot_number,testing_status) values($1,'L1','passed') returning id`, [p])).rows[0].id;
  const testing = (await q(`insert into lots(product_id,lot_number) values($1,'L2') returning id`, [p])).rows[0].id;
  await q(`insert into stock(variant_id,lot_id,location_id,quantity) values($1,$2,$4,3),($1,$3,$4,5)`, [kit, passed, testing, loc]);
  assert.deepEqual(await getSummaryCounts(a), { activeProducts: 1, priorityProducts: 1, lotsInTesting: 1, sellableUnits: 30 });
  assert.deepEqual(await getSummaryCounts(b), { activeProducts: 0, priorityProducts: 0, lotsInTesting: 0, sellableUnits: 0 });

  // New tables enforce their rules
  const count1 = (await q(`insert into stock_counts(business_id,location_id,started_by) values($1,$2,'mgr1') returning id`, [a, loc])).rows[0].id;
  await assert.rejects(q(`insert into stock_counts(business_id,location_id,started_by) values($1,$2,'mgr1')`, [a, loc]), "one open count per location");
  await assert.rejects(q(`insert into stock_count_lines(stock_count_id,variant_id,lot_id,expected_qty,counted_qty) values($1,$2,$3,3,-1)`, [count1, kit, passed]), "no negative counts");
  await q(`update stock_counts set status='finished' where id=$1`, [count1]);
  await q(`insert into stock_counts(business_id,location_id,started_by) values($1,$2,'mgr1')`, [a, loc]);

  console.log("✓ foundation tests passed");
  return { a, b };
}
