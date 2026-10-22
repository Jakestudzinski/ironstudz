import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { InboundError } from "./errors";

export type Delivery = {
  business_id: string;
  reference: string;
  received_at?: string;
  notes?: string;
  lines: { sku: string; lot_number: string; quantity: number; location?: string }[];
};

/**
 * Records a stock delivery entered by a manager.
 * - New lots start as "in_testing" (not sellable until marked passed).
 * - More stock for an existing lot is added to it; its testing status is unchanged.
 * - Goes to the line's location, or the variant's home location if none is given.
 * The whole delivery is rejected if any line is invalid, so nothing is half-recorded.
 * Sending the same reference twice only records it once.
 */
export async function recordDelivery(c: PoolClient, userId: string, d: Delivery) {
  const receivedAt = d.received_at ?? new Date().toISOString();

  const inserted = await c.query(
    `INSERT INTO receipts (business_id, reference, received_at, notes, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_id, reference) DO NOTHING
     RETURNING id`,
    [d.business_id, d.reference, receivedAt, d.notes ?? null, userId]
  );
  if (inserted.rowCount === 0) {
    return { ok: true, duplicate: true, reference: d.reference };
  }
  const receiptId: string = inserted.rows[0].id;
  const groupId = randomUUID();
  const results = [];

  for (const [index, line] of d.lines.entries()) {
    const v = await c.query(
      `SELECT id, product_id, home_location_id FROM variants
        WHERE business_id = $1 AND sku = $2 AND is_active`,
      [d.business_id, line.sku]
    );
    if (v.rowCount === 0) {
      throw new InboundError(400, `Line ${index + 1}: unknown SKU "${line.sku}"`);
    }
    const variant = v.rows[0];

    let locationId: string | null = variant.home_location_id;
    let locationName: string | null = null;
    if (line.location) {
      const loc = await c.query(`SELECT id, name FROM locations WHERE name = $1 AND is_active`, [line.location]);
      if (loc.rowCount === 0) throw new InboundError(400, `Line ${index + 1}: unknown location "${line.location}"`);
      locationId = loc.rows[0].id;
      locationName = loc.rows[0].name;
    }
    if (!locationId) {
      throw new InboundError(400, `Line ${index + 1}: no location given and "${line.sku}" has no home location`);
    }

    // Create the lot, or reuse it if this lot number already exists for the product.
    const lot = await c.query(
      `INSERT INTO lots (product_id, lot_number, received_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (product_id, lot_number)
         DO UPDATE SET lot_number = EXCLUDED.lot_number
       RETURNING id, testing_status, (xmax = 0) AS created`,
      [variant.product_id, line.lot_number, receivedAt]
    );
    const lotRow = lot.rows[0];

    await c.query(
      `INSERT INTO stock (variant_id, lot_id, location_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (variant_id, lot_id, location_id)
         DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity, updated_at = now()`,
      [variant.id, lotRow.id, locationId, line.quantity]
    );

    await c.query(
      `INSERT INTO movements
         (business_id, movement_type, variant_id, lot_id, to_location_id, quantity, receipt_id, user_id, group_id)
       VALUES ($1, 'received', $2, $3, $4, $5, $6, $7, $8)`,
      [d.business_id, variant.id, lotRow.id, locationId, line.quantity, receiptId, userId, groupId]
    );

    results.push({
      sku: line.sku,
      lot_number: line.lot_number,
      quantity: line.quantity,
      location: locationName ?? "home location",
      lot_status: lotRow.testing_status,
      new_lot: lotRow.created,
    });
  }

  return { ok: true, duplicate: false, reference: d.reference, receipt_id: receiptId, lines: results };
}
