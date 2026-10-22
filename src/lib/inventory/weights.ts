import { pool } from "./db";

export { vialsFromWeight, RECOUNT_THRESHOLD, type WeightCount } from "./weight-count";

export type VialWeightRow = {
  id: string;
  name: string;
  strengthSize: string | null;
  category: string;
  vialWeightG: number | null;
  updatedAt: string | null;
};

/** Every active product of one business with its weight of one vial (null if not set yet). */
export async function listVialWeights(businessId: string): Promise<VialWeightRow[]> {
  const { rows } = await pool.query(
    `SELECT id, name, strength_size AS "strengthSize", category,
            vial_weight_g::float8 AS "vialWeightG",
            vial_weight_updated_at AS "updatedAt"
       FROM products
      WHERE business_id = $1 AND is_active
      ORDER BY name, strength_size NULLS FIRST`,
    [businessId]
  );
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null }));
}

/**
 * Sets (or clears, with null) one product's weight of one vial.
 * Only touches a product of the given business; returns false if there isn't one.
 */
export async function setVialWeight(
  businessId: string,
  userId: string,
  productId: string,
  vialWeightG: number | null
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE products
        SET vial_weight_g = $3, vial_weight_updated_at = now(), vial_weight_updated_by = $4, updated_at = now()
      WHERE id = $1 AND business_id = $2`,
    [productId, businessId, vialWeightG, userId]
  );
  return (rowCount ?? 0) > 0;
}
