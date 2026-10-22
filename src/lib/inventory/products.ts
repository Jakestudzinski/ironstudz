import { pool } from "./db";
import {
  coverStatus,
  type Category,
  type CoverStatus,
  type FormCounts,
  type PackageType,
} from "./product-meta";

export type ProductFilters = {
  search?: string;
  category?: Category;
  locationId?: string;
  priorityOnly?: boolean;
  includeInactive?: boolean;
  sort?: "name" | "days" | "total";
};

export type ProductListRow = {
  id: string;
  name: string;
  strengthSize: string | null;
  category: Category;
  isPriority: boolean;
  isActive: boolean;
  forms: PackageType[];
  sellable: FormCounts;
  inTesting: FormCounts;
  /** Passed stock in vial equivalents (units for skin care and pre-workouts). */
  total: number;
  salesPerDay: number;
  daysOfCover: number | null;
  status: CoverStatus;
};

type Settings = { coverDays: number; salesWindowDays: number };

async function getSettings(businessId: string): Promise<Settings> {
  const { rows } = await pool.query(
    `SELECT cover_days AS "coverDays", sales_window_days AS "salesWindowDays"
       FROM alert_settings WHERE business_id = $1`,
    [businessId]
  );
  return rows[0] ?? { coverDays: 90, salesWindowDays: 60 };
}

/** Vial equivalents sold per product over the sales window, as a map of product id → per day. */
async function salesPerDay(businessId: string, windowDays: number, productId?: string): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `SELECT v.product_id, sum(m.quantity * v.units_per_package)::int AS sold
       FROM movements m
       JOIN variants v ON v.id = m.variant_id
      WHERE m.business_id = $1 AND m.movement_type = 'sold'
        AND m.created_at >= now() - make_interval(days => $2)
        AND ($3::uuid IS NULL OR v.product_id = $3)
      GROUP BY v.product_id`,
    [businessId, windowDays, productId ?? null]
  );
  return new Map(rows.map((r) => [r.product_id as string, r.sold / windowDays]));
}

function cover(total: number, perDay: number, coverDays: number) {
  const daysOfCover = perDay > 0 ? Math.floor(total / perDay) : null;
  return { salesPerDay: Math.round(perDay * 10) / 10, daysOfCover, status: coverStatus(daysOfCover, coverDays) };
}

/** Products of one business with their stock mix, days of cover and status. */
export async function listProducts(businessId: string, f: ProductFilters = {}) {
  const settings = await getSettings(businessId);
  const search = f.search?.trim() ? `%${f.search.trim()}%` : null;

  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.strength_size AS "strengthSize", p.category,
            p.is_priority AS "isPriority", p.is_active AS "isActive"
       FROM products p
      WHERE p.business_id = $1
        AND ($2::boolean OR p.is_active)
        AND ($3::text IS NULL OR p.category = $3)
        AND (NOT $4::boolean OR p.is_priority)
        AND ($5::text IS NULL
             OR p.name ILIKE $5 OR p.strength_size ILIKE $5
             OR (p.name || ' ' || coalesce(p.strength_size, '')) ILIKE $5
             OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku ILIKE $5))
        AND ($6::uuid IS NULL OR EXISTS (
             SELECT 1 FROM stock s JOIN variants v ON v.id = s.variant_id
              WHERE v.product_id = p.id AND s.location_id = $6 AND s.quantity > 0))`,
    [businessId, !!f.includeInactive, f.category ?? null, !!f.priorityOnly, search, f.locationId ?? null]
  );

  const stock = await pool.query(
    `SELECT v.product_id, v.package_type, v.units_per_package,
            coalesce(sum(s.quantity) FILTER (WHERE l.testing_status = 'passed'), 0)::int AS passed,
            coalesce(sum(s.quantity) FILTER (WHERE l.testing_status = 'in_testing'), 0)::int AS testing
       FROM variants v
       LEFT JOIN stock s ON s.variant_id = v.id
       LEFT JOIN lots l ON l.id = s.lot_id
      WHERE v.business_id = $1 AND v.is_active
      GROUP BY v.product_id, v.package_type, v.units_per_package`,
    [businessId]
  );
  const sales = await salesPerDay(businessId, settings.salesWindowDays);

  const byProduct = new Map<string, { forms: PackageType[]; sellable: FormCounts; inTesting: FormCounts; total: number }>();
  for (const r of stock.rows) {
    const e = byProduct.get(r.product_id) ?? { forms: [], sellable: {}, inTesting: {}, total: 0 };
    const t = r.package_type as PackageType;
    e.forms.push(t);
    e.sellable[t] = (e.sellable[t] ?? 0) + r.passed;
    if (r.testing) e.inTesting[t] = (e.inTesting[t] ?? 0) + r.testing;
    e.total += r.passed * r.units_per_package;
    byProduct.set(r.product_id, e);
  }

  const list: ProductListRow[] = rows.map((p) => {
    const s = byProduct.get(p.id) ?? { forms: [], sellable: {}, inTesting: {}, total: 0 };
    return { ...p, ...s, ...cover(s.total, sales.get(p.id) ?? 0, settings.coverDays) };
  });

  const byName = (a: ProductListRow, b: ProductListRow) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) ||
    (a.strengthSize ?? "").localeCompare(b.strengthSize ?? "", "en", { numeric: true });
  if (f.sort === "days") {
    // Fewest days first (most urgent); products with no sales last.
    list.sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) || byName(a, b));
  } else if (f.sort === "total") {
    list.sort((a, b) => b.total - a.total || byName(a, b));
  } else {
    list.sort(byName);
  }

  const counts = await pool.query(
    `SELECT count(*) FILTER (WHERE is_active)::int AS active,
            count(*) FILTER (WHERE is_active AND is_priority)::int AS priority
       FROM products WHERE business_id = $1`,
    [businessId]
  );
  return { products: list, active: counts.rows[0].active as number, priority: counts.rows[0].priority as number };
}

export type StockLine = {
  packageType: PackageType;
  lotNumber: string;
  location: string;
  quantity: number;
  testingStatus: "in_testing" | "passed" | "failed";
};

export type VariantRow = {
  id: string;
  packageType: PackageType;
  sku: string;
  homeLocationId: string | null;
  homeLocation: string | null;
  minLevel: number;
  isActive: boolean;
  onHand: number;
};

export type HistoryRow = {
  id: string;
  createdAt: string;
  type: "received" | "sold" | "break_down" | "transfer" | "adjustment";
  packageType: PackageType;
  quantity: number;
  lotNumber: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  orderRef: string | null;
  notes: string | null;
  /** null means the change came from a business website (a paid order). */
  who: string | null;
};

/** Everything the product detail screen shows. Null if the product isn't in this business. */
export async function getProductDetail(businessId: string, productId: string) {
  const p = await pool.query(
    `SELECT id, name, strength_size AS "strengthSize", category, is_priority AS "isPriority",
            is_active AS "isActive", vial_weight_g::float8 AS "vialWeightG"
       FROM products WHERE id = $1 AND business_id = $2`,
    [productId, businessId]
  );
  if (p.rowCount === 0) return null;
  const product = p.rows[0] as {
    id: string; name: string; strengthSize: string | null; category: Category;
    isPriority: boolean; isActive: boolean; vialWeightG: number | null;
  };

  const settings = await getSettings(businessId);

  const lines = await pool.query(
    `SELECT v.package_type AS "packageType", l.lot_number AS "lotNumber", loc.name AS location,
            s.quantity, l.testing_status AS "testingStatus", v.units_per_package AS units
       FROM stock s
       JOIN variants v ON v.id = s.variant_id
       JOIN lots l ON l.id = s.lot_id
       JOIN locations loc ON loc.id = s.location_id
      WHERE v.product_id = $1 AND s.quantity > 0
      ORDER BY array_position(ARRAY['kit','half_kit','vial','unit'], v.package_type),
               l.received_at, l.lot_number, loc.name`,
    [productId]
  );

  const variants = await pool.query(
    `SELECT v.id, v.package_type AS "packageType", v.sku, v.home_location_id AS "homeLocationId",
            loc.name AS "homeLocation", v.min_level AS "minLevel", v.is_active AS "isActive",
            coalesce((SELECT sum(s.quantity) FROM stock s JOIN lots l ON l.id = s.lot_id
                       WHERE s.variant_id = v.id AND l.testing_status = 'passed'), 0)::int AS "onHand"
       FROM variants v
       LEFT JOIN locations loc ON loc.id = v.home_location_id
      WHERE v.product_id = $1
      ORDER BY array_position(ARRAY['kit','half_kit','vial','unit'], v.package_type), v.sku`,
    [productId]
  );

  const history = await pool.query(
    `SELECT m.id::text, m.created_at AS "createdAt", m.movement_type AS type, v.package_type AS "packageType",
            m.quantity, l.lot_number AS "lotNumber", lf.name AS "from", lt.name AS "to",
            m.reason, m.order_ref AS "orderRef", m.notes,
            CASE WHEN m.user_id IS NULL THEN NULL ELSE coalesce(u.name, u.email, 'Manager') END AS who
       FROM movements m
       JOIN variants v ON v.id = m.variant_id
       JOIN lots l ON l.id = m.lot_id
       LEFT JOIN locations lf ON lf.id = m.from_location_id
       LEFT JOIN locations lt ON lt.id = m.to_location_id
       LEFT JOIN "User" u ON u.id = m.user_id
      WHERE v.product_id = $1
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 20`,
    [productId]
  );

  let sellable = 0;
  let inTesting = 0;
  const sellableMix: FormCounts = {};
  for (const r of lines.rows) {
    if (r.testingStatus === "passed") {
      sellable += r.quantity * r.units;
      sellableMix[r.packageType as PackageType] = (sellableMix[r.packageType as PackageType] ?? 0) + r.quantity;
    } else if (r.testingStatus === "in_testing") {
      inTesting += r.quantity * r.units;
    }
  }
  const sales = await salesPerDay(businessId, settings.salesWindowDays, productId);

  return {
    product,
    salesWindowDays: settings.salesWindowDays,
    sellable,
    inTesting,
    sellableMix,
    ...cover(sellable, sales.get(productId) ?? 0, settings.coverDays),
    stock: lines.rows.map((r) => ({
      packageType: r.packageType, lotNumber: r.lotNumber, location: r.location, quantity: r.quantity, testingStatus: r.testingStatus,
    })) as StockLine[],
    variants: variants.rows as VariantRow[],
    history: history.rows.map((h) => ({ ...h, createdAt: new Date(h.createdAt).toISOString() })) as HistoryRow[],
  };
}

export type LocationOption = { id: string; name: string; area: "back_stock" | "packing_station" | "storage" };

export async function listLocations(): Promise<LocationOption[]> {
  const { rows } = await pool.query(
    `SELECT id, name, area FROM locations WHERE is_active
      ORDER BY array_position(ARRAY['back_stock','packing_station','storage'], area), name`
  );
  return rows;
}
