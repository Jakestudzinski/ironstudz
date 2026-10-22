import { pool } from "./db";
import type { PackageType } from "./product-meta";
import type { LotStatus } from "./operation-labels";

/** A product form for pickers, e.g. "BPC-157 10mg · Kit". */
export type VariantOption = {
  id: string;
  productId: string;
  label: string;
  packageType: PackageType;
  sku: string;
  homeLocationId: string | null;
  homeLocation: string | null;
};

/** Active forms of active products, for Receive stock and Adjustment. */
export async function listVariantOptions(businessId: string): Promise<VariantOption[]> {
  const { rows } = await pool.query(
    `SELECT v.id, v.product_id AS "productId", v.package_type AS "packageType", v.sku,
            v.home_location_id AS "homeLocationId", loc.name AS "homeLocation",
            trim(p.name || ' ' || coalesce(p.strength_size, '')) AS product
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN locations loc ON loc.id = v.home_location_id
      WHERE v.business_id = $1 AND v.is_active AND p.is_active
      ORDER BY p.name, p.strength_size, array_position(ARRAY['kit','half_kit','vial','unit'], v.package_type)`,
    [businessId]
  );
  const form = { kit: "Kit", half_kit: "Half kit", vial: "Vial", unit: "Unit" } as const;
  return rows.map(({ product, ...r }) => ({ ...r, label: `${product} · ${form[r.packageType as PackageType]}` }));
}

/** One stock line (form + lot + location) that has something in it. */
export type StockOption = {
  variantId: string;
  productId: string;
  product: string;
  packageType: PackageType;
  lotId: string;
  lotNumber: string;
  testingStatus: LotStatus;
  receivedAt: string;
  locationId: string;
  location: string;
  quantity: number;
};

/** Everything on the shelves for one business, oldest lot first. Optionally only some forms. */
export async function listStock(businessId: string, forms?: PackageType[]): Promise<StockOption[]> {
  const { rows } = await pool.query(
    `SELECT v.id AS "variantId", v.product_id AS "productId", v.package_type AS "packageType",
            trim(p.name || ' ' || coalesce(p.strength_size, '')) AS product,
            l.id AS "lotId", l.lot_number AS "lotNumber", l.testing_status AS "testingStatus", l.received_at AS "receivedAt",
            loc.id AS "locationId", loc.name AS location, s.quantity
       FROM stock s
       JOIN variants v ON v.id = s.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN lots l ON l.id = s.lot_id
       JOIN locations loc ON loc.id = s.location_id
      WHERE v.business_id = $1 AND s.quantity > 0 AND ($2::text[] IS NULL OR v.package_type = ANY($2))
      ORDER BY p.name, p.strength_size, array_position(ARRAY['kit','half_kit','vial','unit'], v.package_type),
               l.received_at, l.lot_number, loc.name`,
    [businessId, forms ?? null]
  );
  return rows.map((r) => ({ ...r, receivedAt: new Date(r.receivedAt).toISOString() }));
}

/** Every lot of the business's products, for adding stock back to a lot with an adjustment. */
export async function listLotOptions(businessId: string) {
  const { rows } = await pool.query(
    `SELECT l.id, l.product_id AS "productId", l.lot_number AS "lotNumber", l.testing_status AS "testingStatus"
       FROM lots l JOIN products p ON p.id = l.product_id
      WHERE p.business_id = $1
      ORDER BY l.received_at DESC, l.lot_number`,
    [businessId]
  );
  return rows as { id: string; productId: string; lotNumber: string; testingStatus: LotStatus }[];
}

export type LotRow = {
  id: string;
  product: string;
  productId: string;
  lotNumber: string;
  status: LotStatus;
  receivedAt: string;
  daysWaiting: number;
  overdue: boolean;
  stock: Partial<Record<PackageType, number>>;
  units: number;
  changedAt: string | null;
  changedBy: string | null;
  lastNote: string | null;
};

/** Lots by status with what's left of each. In testing: oldest first. Others: most recently decided first. */
export async function listLots(businessId: string) {
  const settings = await pool.query(`SELECT testing_overdue_days AS d FROM alert_settings WHERE business_id = $1`, [businessId]);
  const overdueDays: number = settings.rows[0]?.d ?? 40;

  const { rows } = await pool.query(
    `SELECT l.id, l.product_id AS "productId", trim(p.name || ' ' || coalesce(p.strength_size, '')) AS product,
            l.lot_number AS "lotNumber", l.testing_status AS status, l.received_at AS "receivedAt",
            floor(extract(epoch FROM now() - l.received_at) / 86400)::int AS "daysWaiting",
            l.status_changed_at AS "changedAt",
            coalesce(u.name, u.email, l.status_changed_by) AS "changedBy",
            (SELECT note FROM lot_status_changes c WHERE c.lot_id = l.id ORDER BY changed_at DESC, id DESC LIMIT 1) AS "lastNote",
            coalesce((SELECT json_object_agg(t.package_type, t.qty) FROM (
                SELECT v.package_type, sum(s.quantity)::int AS qty FROM stock s JOIN variants v ON v.id = s.variant_id
                 WHERE s.lot_id = l.id AND s.quantity > 0 GROUP BY v.package_type) t), '{}'::json) AS stock,
            coalesce((SELECT sum(s.quantity * v.units_per_package) FROM stock s JOIN variants v ON v.id = s.variant_id
                       WHERE s.lot_id = l.id), 0)::int AS units
       FROM lots l
       JOIN products p ON p.id = l.product_id
       LEFT JOIN "User" u ON u.id = l.status_changed_by
      WHERE p.business_id = $1
      ORDER BY l.received_at, l.lot_number`,
    [businessId]
  );
  const lots: LotRow[] = rows.map((r) => ({
    ...r,
    receivedAt: new Date(r.receivedAt).toISOString(),
    changedAt: r.changedAt ? new Date(r.changedAt).toISOString() : null,
    overdue: r.status === "in_testing" && r.daysWaiting > overdueDays,
  }));
  const byDecision = (a: LotRow, b: LotRow) => (b.changedAt ?? "").localeCompare(a.changedAt ?? "");
  return {
    overdueDays,
    inTesting: lots.filter((l) => l.status === "in_testing"),
    failed: lots.filter((l) => l.status === "failed").sort(byDecision),
    passed: lots.filter((l) => l.status === "passed").sort(byDecision),
  };
}
