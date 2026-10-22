import assert from "node:assert/strict";
import { pool } from "@/lib/inventory/db";
import { listVialWeights, setVialWeight, vialsFromWeight } from "@/lib/inventory/weights";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);

export async function weightTests() {
  // Conversion: rounds to the nearest vial, flags anything more than a third of a vial off
  assert.deepEqual(vialsFromWeight(52, 5.2), { vials: 10, exact: 10, recount: false });
  assert.deepEqual(vialsFromWeight(53.5, 5.2), { vials: 10, exact: 10.29, recount: false });
  assert.deepEqual(vialsFromWeight(54.2, 5.2), { vials: 10, exact: 10.42, recount: true });
  assert.deepEqual(vialsFromWeight(49.5, 5.2), { vials: 10, exact: 9.52, recount: true });
  assert.equal(vialsFromWeight(0, 5.2)!.vials, 0);
  assert.equal(vialsFromWeight(52, 0), null);
  assert.equal(vialsFromWeight(-1, 5.2), null);
  assert.equal(vialsFromWeight(Number.NaN, 5.2), null);

  // Saving and listing, per business only
  const a = (await q(`insert into businesses(name) values('Weigh A') returning id`)).rows[0].id;
  const b = (await q(`insert into businesses(name) values('Weigh B') returning id`)).rows[0].id;
  const pa = (await q(`insert into products(business_id,name,category) values($1,'TB-500','peptide') returning id`, [a])).rows[0].id;
  await q(`insert into products(business_id,name,category,is_active) values($1,'Old one','peptide',false)`, [a]);
  const pb = (await q(`insert into products(business_id,name,category) values($1,'Serum','skin_care') returning id`, [b])).rows[0].id;

  assert.deepEqual((await listVialWeights(a)).map((r) => [r.name, r.vialWeightG]), [["TB-500", null]], "inactive products hidden");
  assert.equal(await setVialWeight(a, "mgr1", pa, 5.25), true);
  const row = (await listVialWeights(a))[0];
  assert.equal(row.vialWeightG, 5.25);
  assert.ok(row.updatedAt);
  assert.equal((await q(`select vial_weight_updated_by u from products where id=$1`, [pa])).rows[0].u, "mgr1");

  // Can't change another business's product
  assert.equal(await setVialWeight(a, "mgr1", pb, 9), false);
  assert.equal((await listVialWeights(b))[0].vialWeightG, null);

  // Clearing works; zero or negative is refused by the database
  assert.equal(await setVialWeight(a, "mgr1", pa, null), true);
  assert.equal((await listVialWeights(a))[0].vialWeightG, null);
  await assert.rejects(setVialWeight(a, "mgr1", pa, 0));
  await assert.rejects(setVialWeight(a, "mgr1", pa, -2));

  console.log("✓ weight tests passed");
}
