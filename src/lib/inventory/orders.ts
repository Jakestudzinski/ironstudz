import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { InboundError } from "./errors";

export type PaidOrder = {
  order_ref: string;
  paid_at?: string;
  lines: { sku: string; quantity: number }[];
};

type Issue = { sku: string; issue: "unknown_sku" | "insufficient_stock"; requested: number; deducted: number };

/**
 * Records a paid order and deducts stock FIFO:
 * oldest PASSED lot first (by received date), preferring the variant's home location.
 * Lots in testing or failed are never sold. Stock never goes below zero; any shortfall
 * or unknown SKU is saved as an issue and the order is flagged for review.
 * Sending the same order twice only deducts once.
 */
export async function recordPaidOrder(c: PoolClient, businessId: string, order: PaidOrder) {
  const inserted = await c.query(
    `INSERT INTO inbound_orders (business_id, order_ref, paid_at)
     VALUES ($1, $2, COALESCE($3::timestamptz, now()))
     ON CONFLICT (business_id, order_ref) DO NOTHING
     RETURNING id`,
    [businessId, order.order_ref, order.paid_at ?? null]
  );
  if (inserted.rowCount === 0) {
    return { ok: true, duplicate: true, order_ref: order.order_ref };
  }
  const orderId: string = inserted.rows[0].id;
  const groupId = randomUUID();

  // Combine repeated SKUs in one order into a single line.
  const lines = new Map<string, number>();
  for (const l of order.lines) lines.set(l.sku, (lines.get(l.sku) ?? 0) + l.quantity);

  const issues: Issue[] = [];
  const deducted: { sku: string; lot_id: string; location_id: string; quantity: number }[] = [];

  for (const [sku, requested] of lines) {
    const v = await c.query(
      `SELECT id, home_location_id FROM variants
        WHERE business_id = $1 AND sku = $2 AND is_active`,
      [businessId, sku]
    );
    if (v.rowCount === 0) {
      issues.push({ sku, issue: "unknown_sku", requested, deducted: 0 });
      continue;
    }
    const variant = v.rows[0];

    // Lock the candidate stock rows so two orders can't take the same units.
    const candidates = await c.query(
      `SELECT s.id, s.lot_id, s.location_id, s.quantity
         FROM stock s
         JOIN lots l ON l.id = s.lot_id
        WHERE s.variant_id = $1
          AND l.testing_status = 'passed'
          AND s.quantity > 0
        ORDER BY l.received_at ASC,
                 (s.location_id IS NOT DISTINCT FROM $2) DESC,
                 s.id
        FOR UPDATE OF s`,
      [variant.id, variant.home_location_id]
    );

    let remaining = requested;
    for (const row of candidates.rows) {
      if (remaining === 0) break;
      const take = Math.min(remaining, row.quantity);
      await c.query(`UPDATE stock SET quantity = quantity - $1, updated_at = now() WHERE id = $2`, [take, row.id]);
      await c.query(
        `INSERT INTO movements
           (business_id, movement_type, variant_id, lot_id, from_location_id, quantity, order_ref, group_id)
         VALUES ($1, 'sold', $2, $3, $4, $5, $6, $7)`,
        [businessId, variant.id, row.lot_id, row.location_id, take, order.order_ref, groupId]
      );
      deducted.push({ sku, lot_id: row.lot_id, location_id: row.location_id, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) {
      issues.push({ sku, issue: "insufficient_stock", requested, deducted: requested - remaining });
    }
  }

  for (const i of issues) {
    await c.query(
      `INSERT INTO inbound_order_issues (inbound_order_id, sku, quantity_requested, quantity_deducted, issue)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, i.sku, i.requested, i.deducted, i.issue]
    );
  }
  if (issues.length > 0) {
    await c.query(`UPDATE inbound_orders SET status = 'needs_review' WHERE id = $1`, [orderId]);
  }

  return {
    ok: true,
    duplicate: false,
    order_ref: order.order_ref,
    status: issues.length > 0 ? "needs_review" : "processed",
    deducted,
    issues,
  };
}

/**
 * Marks a paid order as cancelled or refunded. Stock is NOT added back:
 * the order appears in "Cancelled orders to review" for a manager to check.
 */
export async function recordCancellation(
  c: PoolClient,
  businessId: string,
  orderRef: string,
  type: "cancelled" | "refunded",
  cancelledAt?: string
) {
  const updated = await c.query(
    `UPDATE inbound_orders
        SET cancelled_at = COALESCE($3::timestamptz, now()), cancel_type = $4
      WHERE business_id = $1 AND order_ref = $2 AND cancelled_at IS NULL
      RETURNING cancelled_at`,
    [businessId, orderRef, cancelledAt ?? null, type]
  );
  if (updated.rowCount === 1) {
    return { ok: true, duplicate: false, order_ref: orderRef, cancelled_at: updated.rows[0].cancelled_at };
  }
  const existing = await c.query(
    `SELECT cancelled_at FROM inbound_orders WHERE business_id = $1 AND order_ref = $2`,
    [businessId, orderRef]
  );
  if (existing.rowCount === 0) {
    throw new InboundError(404, `Order ${orderRef} has not been received as a paid order`);
  }
  return { ok: true, duplicate: true, order_ref: orderRef, cancelled_at: existing.rows[0].cancelled_at };
}
