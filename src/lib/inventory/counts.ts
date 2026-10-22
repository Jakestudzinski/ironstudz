import type { PoolClient } from "pg";
import { pool } from "./db";
import { InboundError } from "./errors";
import { vialsFromWeight } from "./weight-count";
import type { PackageType } from "./product-meta";
import type { LotStatus } from "./operation-labels";

// Stock counts: one open count per location. Starting a count lists every stock line on that shelf with the
// quantity the system expects. Managers enter what they find (as a number, or as a weight for vials).
// Finishing posts a count-correction adjustment for each counted line that differs from the stock at that
// moment; blank lines are skipped.

const bad = (m: string) => new InboundError(400, m);

async function getOpenCount(c: PoolClient, businessId: string, countId: string, lock = false) {
  const { rows } = await c.query(
    `SELECT sc.id, sc.status, sc.location_id, loc.name AS location
       FROM stock_counts sc JOIN locations loc ON loc.id = sc.location_id
      WHERE sc.id = $1 AND sc.business_id = $2 ${lock ? "FOR UPDATE OF sc" : ""}`,
    [countId, businessId]
  );
  const sc = rows[0];
  if (!sc) throw new InboundError(404, "That count isn't in this business");
  if (sc.status !== "open") throw bad(`This count at ${sc.location} is already ${sc.status}`);
  return sc as { id: string; status: string; location_id: string; location: string };
}

export async function startCount(c: PoolClient, businessId: string, userId: string, locationId: string) {
  const loc = await c.query(`SELECT id, name FROM locations WHERE id = $1 AND is_active`, [locationId]);
  if (!loc.rows[0]) throw bad("Choose a location from the list");
  let countId: string;
  try {
    await c.query("SAVEPOINT start_count");
    const r = await c.query(
      `INSERT INTO stock_counts (business_id, location_id, started_by) VALUES ($1, $2, $3) RETURNING id`,
      [businessId, locationId, userId]
    );
    countId = r.rows[0].id;
  } catch (err) {
    // stock_counts_one_open_idx: only one open count per business and location
    if ((err as { code?: string }).code === "23505") {
      await c.query("ROLLBACK TO SAVEPOINT start_count");
      throw bad(`A count is already open at ${loc.rows[0].name}. Carry on with that one, or cancel it first.`);
    }
    throw err;
  }
  const lines = await c.query(
    `INSERT INTO stock_count_lines (stock_count_id, variant_id, lot_id, expected_qty)
     SELECT $1, s.variant_id, s.lot_id, s.quantity
       FROM stock s JOIN variants v ON v.id = s.variant_id
      WHERE v.business_id = $2 AND s.location_id = $3 AND s.quantity > 0`,
    [countId, businessId, locationId]
  );
  return { countId, lines: lines.rowCount ?? 0, location: loc.rows[0].name as string };
}

export type CountLine = {
  id: string;
  product: string;
  productId: string;
  packageType: PackageType;
  sku: string;
  lotNumber: string;
  testingStatus: LotStatus;
  expected: number;
  /** What the system has right now; differs from expected if stock moved while the count was open. */
  current: number;
  counted: number | null;
  countedWeightG: number | null;
  vialWeightG: number | null;
};

export async function getCount(businessId: string, countId: string) {
  const head = await pool.query(
    `SELECT sc.id, sc.status, sc.location_id AS "locationId", loc.name AS location, sc.started_at AS "startedAt",
            sc.finished_at AS "finishedAt", coalesce(u.name, u.email, sc.started_by) AS "startedBy"
       FROM stock_counts sc JOIN locations loc ON loc.id = sc.location_id
       LEFT JOIN "User" u ON u.id = sc.started_by
      WHERE sc.id = $1 AND sc.business_id = $2`,
    [countId, businessId]
  );
  if (!head.rows[0]) return null;
  const h = head.rows[0];
  const { rows } = await pool.query(
    `SELECT cl.id, trim(p.name || ' ' || coalesce(p.strength_size, '')) AS product, p.id AS "productId",
            v.package_type AS "packageType", v.sku, l.lot_number AS "lotNumber", l.testing_status AS "testingStatus",
            cl.expected_qty AS expected, cl.counted_qty AS counted, cl.counted_weight_g::float8 AS "countedWeightG",
            CASE WHEN v.package_type = 'vial' THEN p.vial_weight_g::float8 END AS "vialWeightG",
            coalesce((SELECT s.quantity FROM stock s WHERE s.variant_id = cl.variant_id AND s.lot_id = cl.lot_id
                        AND s.location_id = $2), 0) AS current
       FROM stock_count_lines cl
       JOIN variants v ON v.id = cl.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN lots l ON l.id = cl.lot_id
      WHERE cl.stock_count_id = $1
      ORDER BY p.name, p.strength_size, array_position(ARRAY['kit','half_kit','vial','unit'], v.package_type), l.received_at`,
    [countId, h.locationId]
  );
  return {
    ...h,
    startedAt: new Date(h.startedAt).toISOString(),
    finishedAt: h.finishedAt ? new Date(h.finishedAt).toISOString() : null,
    lines: rows as CountLine[],
  } as {
    id: string; status: "open" | "finished" | "cancelled"; locationId: string; location: string;
    startedAt: string; finishedAt: string | null; startedBy: string; lines: CountLine[];
  };
}

export async function listCounts(businessId: string) {
  const { rows } = await pool.query(
    `SELECT sc.id, sc.status, loc.name AS location, sc.started_at AS "startedAt", sc.finished_at AS "finishedAt",
            coalesce(u.name, u.email, sc.started_by) AS "startedBy",
            count(cl.id)::int AS lines, count(cl.counted_qty)::int AS counted,
            count(*) FILTER (WHERE cl.counted_qty IS NOT NULL AND cl.counted_qty <> cl.expected_qty)::int AS differences
       FROM stock_counts sc
       JOIN locations loc ON loc.id = sc.location_id
       LEFT JOIN "User" u ON u.id = sc.started_by
       LEFT JOIN stock_count_lines cl ON cl.stock_count_id = sc.id
      WHERE sc.business_id = $1 AND (sc.status = 'open' OR sc.started_at > now() - interval '60 days')
      GROUP BY sc.id, loc.name, u.name, u.email
      ORDER BY (sc.status = 'open') DESC, sc.started_at DESC
      LIMIT 30`,
    [businessId]
  );
  return rows.map((r) => ({
    ...r,
    startedAt: new Date(r.startedAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
  })) as {
    id: string; status: "open" | "finished" | "cancelled"; location: string; startedAt: string; finishedAt: string | null;
    startedBy: string; lines: number; counted: number; differences: number;
  }[];
}

/**
 * Saves what was found on one line: a number, or (vials only) a weight that's turned into vials using the
 * product's vial weight. Null clears the line back to "not counted".
 */
export async function saveCountLine(
  c: PoolClient, businessId: string, countId: string, lineId: string,
  entry: { counted: number | null; weightG: number | null }
) {
  await getOpenCount(c, businessId, countId);
  const { rows } = await c.query(
    `SELECT cl.id, v.package_type, p.vial_weight_g::float8 AS vial_weight
       FROM stock_count_lines cl JOIN variants v ON v.id = cl.variant_id JOIN products p ON p.id = v.product_id
      WHERE cl.id = $1 AND cl.stock_count_id = $2 FOR UPDATE OF cl`,
    [lineId, countId]
  );
  const line = rows[0];
  if (!line) throw new InboundError(404, "That line isn't on this count");

  let counted = entry.counted;
  let weight: number | null = null;
  let exact: number | null = null;
  let recount = false;
  if (entry.weightG !== null) {
    if (line.package_type !== "vial") throw bad("Only loose vials can be counted by weight");
    if (!line.vial_weight) throw bad("This product has no vial weight yet. Set it on the Vial weights screen, or count by number.");
    const w = vialsFromWeight(entry.weightG, line.vial_weight);
    if (!w) throw bad("Enter the weight in grams, e.g. 52.4");
    counted = w.vials;
    weight = entry.weightG;
    exact = w.exact;
    recount = w.recount;
  }
  if (counted !== null && (!Number.isInteger(counted) || counted < 0)) throw bad("Counts must be whole numbers, 0 or more");
  await c.query(`UPDATE stock_count_lines SET counted_qty = $2, counted_weight_g = $3 WHERE id = $1`, [lineId, counted, weight]);
  return { counted, exact, recount };
}

/** Adds stock found on the shelf that wasn't on the list (a form and lot the system didn't expect there). */
export async function addCountLine(c: PoolClient, businessId: string, countId: string, variantId: string, lotId: string) {
  const sc = await getOpenCount(c, businessId, countId);
  const { rows } = await c.query(
    `SELECT v.id FROM variants v JOIN lots l ON l.product_id = v.product_id
      WHERE v.id = $1 AND l.id = $2 AND v.business_id = $3`,
    [variantId, lotId, businessId]
  );
  if (!rows[0]) throw bad("Choose a form and one of its product's lots");
  const r = await c.query(
    `INSERT INTO stock_count_lines (stock_count_id, variant_id, lot_id, expected_qty)
     VALUES ($1, $2, $3, coalesce((SELECT quantity FROM stock WHERE variant_id = $2 AND lot_id = $3 AND location_id = $4), 0))
     ON CONFLICT (stock_count_id, variant_id, lot_id) DO NOTHING RETURNING id`,
    [countId, variantId, lotId, sc.location_id]
  );
  if (!r.rows[0]) throw bad("That form and lot is already on this count");
  return { lineId: r.rows[0].id as string };
}

/**
 * Finishes the count: for each counted line, sets the shelf to what was counted with a count-correction
 * adjustment (based on the stock right now), and records that stock as the line's expected quantity.
 */
export async function finishCount(c: PoolClient, businessId: string, userId: string, countId: string) {
  const sc = await getOpenCount(c, businessId, countId, true);
  const { rows: lines } = await c.query(
    `SELECT id, variant_id, lot_id, counted_qty FROM stock_count_lines WHERE stock_count_id = $1 AND counted_qty IS NOT NULL`,
    [countId]
  );
  const skipped = (await c.query(
    `SELECT count(*)::int AS n FROM stock_count_lines WHERE stock_count_id = $1 AND counted_qty IS NULL`, [countId]
  )).rows[0].n as number;

  let corrections = 0;
  for (const l of lines) {
    const s = await c.query(
      `SELECT id, quantity FROM stock WHERE variant_id = $1 AND lot_id = $2 AND location_id = $3 FOR UPDATE`,
      [l.variant_id, l.lot_id, sc.location_id]
    );
    const current: number = s.rows[0]?.quantity ?? 0;
    await c.query(`UPDATE stock_count_lines SET expected_qty = $2 WHERE id = $1`, [l.id, current]);
    const diff = l.counted_qty - current;
    if (diff === 0) continue;
    corrections++;
    if (s.rows[0]) {
      await c.query(`UPDATE stock SET quantity = $2, updated_at = now() WHERE id = $1`, [s.rows[0].id, l.counted_qty]);
    } else {
      await c.query(`INSERT INTO stock (variant_id, lot_id, location_id, quantity) VALUES ($1, $2, $3, $4)`,
        [l.variant_id, l.lot_id, sc.location_id, l.counted_qty]);
    }
    await c.query(
      `INSERT INTO movements (business_id, movement_type, variant_id, lot_id, from_location_id, to_location_id,
                              quantity, reason, user_id, group_id, notes)
       VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, 'count_correction', $7, $8, $9)`,
      [businessId, l.variant_id, l.lot_id, diff < 0 ? sc.location_id : null, diff > 0 ? sc.location_id : null,
       Math.abs(diff), userId, countId, `Stock count at ${sc.location}`]
    );
  }
  await c.query(`UPDATE stock_counts SET status = 'finished', finished_by = $2, finished_at = now() WHERE id = $1`, [countId, userId]);
  return { location: sc.location, counted: lines.length, skipped, corrections };
}

export async function cancelCount(c: PoolClient, businessId: string, userId: string, countId: string) {
  const sc = await getOpenCount(c, businessId, countId, true);
  await c.query(`UPDATE stock_counts SET status = 'cancelled', finished_by = $2, finished_at = now() WHERE id = $1`, [countId, userId]);
  return { location: sc.location };
}
