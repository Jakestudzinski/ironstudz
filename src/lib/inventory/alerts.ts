import type { PoolClient } from "pg";
import { pool } from "./db";
import { InboundError } from "./errors";
import { listProducts } from "./products";
import { productLabel, type PackageType } from "./product-meta";

// Alerts are worked out live from current stock and the business's alert_settings.
// Only who reviewed or resolved an item is stored.

export type AlertItem = { id: string; name: string; info: string; href: string };
export type AlertKey = "cover" | "refill" | "low" | "testing" | "count";

export type Alerts = Record<AlertKey, { label: string; title: string; items: AlertItem[] }>;

type Settings = { coverDays: number; overdueDays: number; mismatch: number };

async function settings(businessId: string): Promise<Settings> {
  const { rows } = await pool.query(
    `SELECT cover_days AS "coverDays", testing_overdue_days AS "overdueDays", count_mismatch_threshold AS mismatch
       FROM alert_settings WHERE business_id = $1`,
    [businessId]
  );
  return rows[0] ?? { coverDays: 90, overdueDays: 40, mismatch: 2 };
}

const FORM = { kit: ["kit", "kits"], half_kit: ["half kit", "half kits"], vial: ["vial", "vials"], unit: ["unit", "units"] } as const;
const qty = (n: number, t: PackageType) => `${n} ${FORM[t][n === 1 ? 0 : 1]}`;

/** Every alert for one business. */
export async function getAlerts(businessId: string): Promise<Alerts> {
  const s = await settings(businessId);

  // Priority products below the cover target (products with no sales have no days of cover to compare).
  const { products } = await listProducts(businessId, { priorityOnly: true });
  const cover: AlertItem[] = products
    .filter((p) => p.daysOfCover !== null && p.daysOfCover < s.coverDays)
    .sort((a, b) => a.daysOfCover! - b.daysOfCover!)
    .map((p) => ({
      id: p.id,
      name: productLabel(p),
      info: `${p.daysOfCover} days of cover · ${p.total} ${p.category === "peptide" ? "vials" : "units"} · ${p.salesPerDay}/day`,
      href: `/admin/inventory/products/${p.id}`,
    }));

  // Loose Passed vials on Rack A + Rack C together, below the vial form's min level.
  const refillRows = await pool.query(
    `SELECT v.id, v.product_id, p.name, p.strength_size, v.min_level,
            coalesce(sum(s.quantity) FILTER (WHERE loc.area = 'packing_station' AND l.testing_status = 'passed'), 0)::int AS loose,
            coalesce((SELECT json_object_agg(x.name, x.n) FROM (
                SELECT loc2.name, sum(s3.quantity)::int AS n FROM stock s3
                  JOIN lots l3 ON l3.id = s3.lot_id JOIN locations loc2 ON loc2.id = s3.location_id
                 WHERE s3.variant_id = v.id AND loc2.area = 'packing_station' AND l3.testing_status = 'passed'
                 GROUP BY loc2.name HAVING sum(s3.quantity) > 0) x), '{}'::json) AS racks,
            (SELECT coalesce(sum(s2.quantity), 0) FROM stock s2 JOIN variants k ON k.id = s2.variant_id JOIN lots l2 ON l2.id = s2.lot_id
              WHERE k.product_id = v.product_id AND k.package_type IN ('kit', 'half_kit') AND l2.testing_status = 'passed')::int AS sealed
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN stock s ON s.variant_id = v.id
       LEFT JOIN lots l ON l.id = s.lot_id
       LEFT JOIN locations loc ON loc.id = s.location_id
      WHERE v.business_id = $1 AND v.package_type = 'vial' AND v.is_active AND p.is_active AND v.min_level > 0
      GROUP BY v.id, p.id
     HAVING coalesce(sum(s.quantity) FILTER (WHERE loc.area = 'packing_station' AND l.testing_status = 'passed'), 0) < v.min_level
      ORDER BY p.name, p.strength_size`,
    [businessId]
  );
  const refill: AlertItem[] = refillRows.rows.map((r) => {
    const racks = Object.entries(r.racks as Record<string, number>).sort().map(([k, n]) => `${k} ${n}`);
    return {
      id: r.id,
      name: productLabel({ name: r.name, strengthSize: r.strength_size }),
      info: `${racks.length ? racks.join(" · ") + " · " : ""}${r.loose} loose (min ${r.min_level}) · ${r.sealed > 0 ? "open a kit" : "no sealed kits left"}`,
      href: `/admin/inventory/break-down?product=${r.product_id}`,
    };
  });

  // Every other active form: total Passed stock below its min level.
  const lowRows = await pool.query(
    `SELECT v.id, v.package_type, p.name, p.strength_size, v.min_level,
            coalesce(sum(s.quantity) FILTER (WHERE l.testing_status = 'passed'), 0)::int AS have
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN stock s ON s.variant_id = v.id
       LEFT JOIN lots l ON l.id = s.lot_id
      WHERE v.business_id = $1 AND v.package_type <> 'vial' AND v.is_active AND p.is_active AND v.min_level > 0
      GROUP BY v.id, p.id
     HAVING coalesce(sum(s.quantity) FILTER (WHERE l.testing_status = 'passed'), 0) < v.min_level
      ORDER BY p.name, p.strength_size, v.package_type`,
    [businessId]
  );
  const low: AlertItem[] = lowRows.rows.map((r) => ({
    id: r.id,
    name: productLabel({ name: r.name, strengthSize: r.strength_size }),
    info: `${qty(r.have, r.package_type)} (min ${r.min_level})`,
    href: `/admin/inventory/receive?variant=${r.id}`,
  }));

  const testingRows = await pool.query(
    `SELECT l.id, l.lot_number, p.name, p.strength_size,
            floor(extract(epoch FROM now() - l.received_at) / 86400)::int AS days
       FROM lots l JOIN products p ON p.id = l.product_id
      WHERE p.business_id = $1 AND l.testing_status = 'in_testing'
        AND floor(extract(epoch FROM now() - l.received_at) / 86400) > $2
      ORDER BY l.received_at`,
    [businessId, s.overdueDays]
  );
  const testing: AlertItem[] = testingRows.rows.map((r) => ({
    id: r.id,
    name: productLabel({ name: r.name, strengthSize: r.strength_size }),
    info: `Lot ${r.lot_number} · ${r.days} days in testing`,
    href: "/admin/inventory/lots",
  }));

  // Finished counts in the last 7 days where a line was off by more than the threshold.
  const countRows = await pool.query(
    `SELECT cl.id, sc.id AS count_id, v.package_type, p.id AS product_id, p.name, p.strength_size, loc.name AS location, lot.lot_number,
            cl.expected_qty, cl.counted_qty
       FROM stock_count_lines cl
       JOIN stock_counts sc ON sc.id = cl.stock_count_id
       JOIN variants v ON v.id = cl.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN lots lot ON lot.id = cl.lot_id
       JOIN locations loc ON loc.id = sc.location_id
      WHERE sc.business_id = $1 AND sc.status = 'finished' AND sc.finished_at >= now() - interval '7 days'
        AND cl.counted_qty IS NOT NULL AND abs(cl.counted_qty - cl.expected_qty) > $2
      ORDER BY sc.finished_at DESC`,
    [businessId, s.mismatch]
  );
  const count: AlertItem[] = countRows.rows.map((r) => ({
    id: r.id,
    name: productLabel({ name: r.name, strengthSize: r.strength_size }),
    info: `${r.location} · lot ${r.lot_number} · expected ${qty(r.expected_qty, r.package_type)}, counted ${r.counted_qty}`,
    href: `/admin/inventory/count/${r.count_id}`,
  }));

  return {
    cover: { label: `Below ${s.coverDays}-day cover`, title: `Priority products below ${s.coverDays} days of cover`, items: cover },
    refill: { label: "Packing station refill", title: "Loose vials running low on Rack A and C", items: refill },
    low: { label: "Low stock", title: "Other forms below their min level", items: low },
    testing: { label: "Testing overdue", title: `Lots in testing over ${s.overdueDays} days`, items: testing },
    count: { label: "Count mismatch", title: `Stock counts off by more than ${s.mismatch} in the last 7 days`, items: count },
  };
}

// ---- Cancelled orders and order issues ----

export type CancelledOrder = {
  id: string; orderRef: string; paidAt: string; cancelledAt: string; type: "cancelled" | "refunded"; items: string[];
};

/** Paid orders that were cancelled or refunded and haven't been reviewed yet, oldest first. */
export async function listCancelledToReview(businessId: string): Promise<CancelledOrder[]> {
  const { rows } = await pool.query(
    `SELECT o.id, o.order_ref AS "orderRef", o.paid_at AS "paidAt", o.cancelled_at AS "cancelledAt", o.cancel_type AS type,
            coalesce((SELECT json_agg(trim(p.name || ' ' || coalesce(p.strength_size, '')) || ' ' ||
                                      replace(v.package_type, '_', ' ') || ' × ' || t.qty ORDER BY p.name)
                        FROM (SELECT m.variant_id, sum(m.quantity)::int AS qty FROM movements m
                               WHERE m.business_id = o.business_id AND m.order_ref = o.order_ref AND m.movement_type = 'sold'
                               GROUP BY m.variant_id) t
                        JOIN variants v ON v.id = t.variant_id JOIN products p ON p.id = v.product_id), '[]'::json) AS items
       FROM inbound_orders o
      WHERE o.business_id = $1 AND o.cancelled_at IS NOT NULL AND o.cancel_reviewed_at IS NULL
      ORDER BY o.cancelled_at`,
    [businessId]
  );
  return rows.map((r) => ({
    ...r, paidAt: new Date(r.paidAt).toISOString(), cancelledAt: new Date(r.cancelledAt).toISOString(),
  }));
}

export type OrderIssue = {
  id: string; orderRef: string; sku: string; product: string | null; issue: "unknown_sku" | "insufficient_stock";
  requested: number; deducted: number; createdAt: string;
};

/** Unresolved unknown-SKU and shortfall problems from paid orders, oldest first. */
export async function listOpenIssues(businessId: string): Promise<OrderIssue[]> {
  const { rows } = await pool.query(
    `SELECT i.id, o.order_ref AS "orderRef", i.sku, i.issue, i.quantity_requested AS requested,
            i.quantity_deducted AS deducted, o.created_at AS "createdAt",
            (SELECT trim(p.name || ' ' || coalesce(p.strength_size, '')) || ' ' || replace(v.package_type, '_', ' ')
               FROM variants v JOIN products p ON p.id = v.product_id
              WHERE v.business_id = o.business_id AND v.sku = i.sku) AS product
       FROM inbound_order_issues i
       JOIN inbound_orders o ON o.id = i.inbound_order_id
      WHERE o.business_id = $1 AND i.resolved_at IS NULL
      ORDER BY o.created_at, i.sku`,
    [businessId]
  );
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
}

/** Marks a cancelled or refunded order as checked. Stock isn't changed here; use an adjustment to put any back. */
export async function markCancelledReviewed(c: PoolClient, businessId: string, userId: string, orderId: string) {
  const { rows } = await c.query(
    `SELECT order_ref, cancelled_at, cancel_reviewed_at FROM inbound_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [orderId, businessId]
  );
  const o = rows[0];
  if (!o) throw new InboundError(404, "That order isn't in this business");
  if (!o.cancelled_at) throw new InboundError(400, `Order ${o.order_ref} hasn't been cancelled`);
  if (o.cancel_reviewed_at) return { orderRef: o.order_ref as string, already: true };
  await c.query(`UPDATE inbound_orders SET cancel_reviewed_at = now(), cancel_reviewed_by = $2 WHERE id = $1`, [orderId, userId]);
  return { orderRef: o.order_ref as string, already: false };
}

/** Closes an order issue with a note saying what was done (e.g. "SKU fixed on the website", "sent from Rack C"). */
export async function resolveIssue(c: PoolClient, businessId: string, userId: string, issueId: string, note: string) {
  if (!note.trim()) throw new InboundError(400, "Add a note saying how it was resolved");
  const { rows } = await c.query(
    `SELECT i.id, i.resolved_at, o.order_ref FROM inbound_order_issues i JOIN inbound_orders o ON o.id = i.inbound_order_id
      WHERE i.id = $1 AND o.business_id = $2 FOR UPDATE OF i`,
    [issueId, businessId]
  );
  if (!rows[0]) throw new InboundError(404, "That order issue isn't in this business");
  if (rows[0].resolved_at) return { orderRef: rows[0].order_ref as string, already: true };
  await c.query(
    `UPDATE inbound_order_issues SET resolved_at = now(), resolved_by = $2, resolution_note = $3 WHERE id = $1`,
    [issueId, userId, note.trim()]
  );
  return { orderRef: rows[0].order_ref as string, already: false };
}
