import { pool } from "./db";

export type BusinessSummaryCounts = {
  activeProducts: number;
  priorityProducts: number;
  lotsInTesting: number;
  sellableUnits: number;
};

/** Headline counts for one business. Sellable = stock in Passed lots, in vial equivalents. */
export async function getSummaryCounts(businessId: string): Promise<BusinessSummaryCounts> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM products WHERE business_id = $1 AND is_active)::int AS "activeProducts",
       (SELECT count(*) FROM products WHERE business_id = $1 AND is_active AND is_priority)::int AS "priorityProducts",
       (SELECT count(*) FROM lots l JOIN products p ON p.id = l.product_id
          WHERE p.business_id = $1 AND l.testing_status = 'in_testing')::int AS "lotsInTesting",
       (SELECT coalesce(sum(s.quantity * v.units_per_package), 0)
          FROM stock s
          JOIN variants v ON v.id = s.variant_id
          JOIN lots l ON l.id = s.lot_id
         WHERE v.business_id = $1 AND l.testing_status = 'passed')::int AS "sellableUnits"`,
    [businessId]
  );
  return rows[0];
}
