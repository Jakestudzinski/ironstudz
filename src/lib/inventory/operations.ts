import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { InboundError } from "./errors";
import { UNITS_PER_PACKAGE, type PackageType } from "./product-meta";
import { ADJUST_REASONS, LOT_STATUSES, type AdjustReason, type LotStatus } from "./operation-labels";

// Daily stock operations. Every change is a movement plus the matching stock update, in the caller's
// transaction, with the affected stock rows locked (SELECT … FOR UPDATE). Stock never goes below zero.

const bad = (message: string) => new InboundError(400, message);

export { ADJUST_REASONS, REASON_LABEL, LOT_STATUSES, type AdjustReason, type LotStatus } from "./operation-labels";

type Variant = { id: string; product_id: string; package_type: PackageType; is_active: boolean };

async function getVariant(c: PoolClient, businessId: string, variantId: string): Promise<Variant> {
  const { rows } = await c.query(
    `SELECT id, product_id, package_type, is_active FROM variants WHERE id = $1 AND business_id = $2`,
    [variantId, businessId]
  );
  if (!rows[0]) throw new InboundError(404, "That product form isn't in this business");
  return rows[0];
}

async function getLot(c: PoolClient, businessId: string, lotId: string, lock = false) {
  const { rows } = await c.query(
    `SELECT l.id, l.product_id, l.lot_number, l.testing_status
       FROM lots l JOIN products p ON p.id = l.product_id
      WHERE l.id = $1 AND p.business_id = $2 ${lock ? "FOR UPDATE OF l" : ""}`,
    [lotId, businessId]
  );
  if (!rows[0]) throw new InboundError(404, "That lot isn't in this business");
  return rows[0] as { id: string; product_id: string; lot_number: string; testing_status: LotStatus };
}

async function checkLocation(c: PoolClient, locationId: string) {
  const { rows } = await c.query(`SELECT id, name FROM locations WHERE id = $1 AND is_active`, [locationId]);
  if (!rows[0]) throw bad("Choose a location from the list");
  return rows[0] as { id: string; name: string };
}

/** Locks one stock line and checks there's enough of it. Returns the locked row. */
async function takeStock(c: PoolClient, variantId: string, lotId: string, locationId: string, qty: number, what: string) {
  const { rows } = await c.query(
    `SELECT s.id, s.quantity, loc.name AS location FROM stock s JOIN locations loc ON loc.id = s.location_id
      WHERE s.variant_id = $1 AND s.lot_id = $2 AND s.location_id = $3 FOR UPDATE OF s`,
    [variantId, lotId, locationId]
  );
  const have = rows[0]?.quantity ?? 0;
  if (have < qty) {
    const where = rows[0]?.location ?? "that location";
    throw bad(have === 0 ? `There are no ${what} of that lot at ${where}.` : `Only ${have} ${what} of that lot at ${where}.`);
  }
  await c.query(`UPDATE stock SET quantity = quantity - $2, updated_at = now() WHERE id = $1`, [rows[0].id, qty]);
}

async function addStock(c: PoolClient, variantId: string, lotId: string, locationId: string, qty: number) {
  await c.query(
    `INSERT INTO stock (variant_id, lot_id, location_id, quantity) VALUES ($1, $2, $3, $4)
     ON CONFLICT (variant_id, lot_id, location_id)
       DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity, updated_at = now()`,
    [variantId, lotId, locationId, qty]
  );
}

type Move = {
  businessId: string; type: "break_down" | "transfer" | "adjustment"; variantId: string; lotId: string;
  from?: string | null; to?: string | null; quantity: number; reason?: AdjustReason | null;
  userId: string; groupId?: string | null; notes?: string | null;
};

async function logMove(c: PoolClient, m: Move) {
  await c.query(
    `INSERT INTO movements (business_id, movement_type, variant_id, lot_id, from_location_id, to_location_id,
                            quantity, reason, user_id, group_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [m.businessId, m.type, m.variantId, m.lotId, m.from ?? null, m.to ?? null, m.quantity, m.reason ?? null,
     m.userId, m.groupId ?? null, m.notes ?? null]
  );
}

const uuid = z.string().uuid();
const qty = z.number().int("Quantity must be a whole number").positive("Quantity must be at least 1").max(100000);

// ---- Break down ----

export const breakDownInput = z.object({
  variantId: uuid, lotId: uuid, fromLocationId: uuid, toLocationId: uuid,
  count: qty.max(100, "Break down at most 100 at a time"),
});
export type BreakDownInput = z.infer<typeof breakDownInput>;

/**
 * Opens sealed kits or half kits: −N kits from their location, +N×10 (or ×5) loose vials of the same
 * product and lot at Rack A or Rack C. Two movements tied together by one group id.
 */
export async function breakDown(c: PoolClient, businessId: string, userId: string, b: BreakDownInput) {
  const kit = await getVariant(c, businessId, b.variantId);
  if (kit.package_type !== "kit" && kit.package_type !== "half_kit") throw bad("Only kits and half kits can be broken down");
  const lot = await getLot(c, businessId, b.lotId);
  if (lot.product_id !== kit.product_id) throw bad("That lot belongs to a different product");
  if (lot.testing_status === "failed") throw bad(`Lot ${lot.lot_number} failed testing and can't be broken down`);
  const to = await checkLocation(c, b.toLocationId);
  const area = await c.query(`SELECT area FROM locations WHERE id = $1`, [to.id]);
  if (area.rows[0].area !== "packing_station") throw bad("Loose vials go to Rack A or Rack C");

  const vial = await c.query(
    `SELECT id FROM variants WHERE product_id = $1 AND package_type = 'vial' AND is_active`,
    [kit.product_id]
  );
  if (!vial.rows[0]) throw bad("This product has no active Vial form to put the loose vials into. Add one on the product page.");

  const vials = b.count * UNITS_PER_PACKAGE[kit.package_type];
  await takeStock(c, kit.id, lot.id, b.fromLocationId, b.count, kit.package_type === "kit" ? "kits" : "half kits");
  await addStock(c, vial.rows[0].id, lot.id, to.id, vials);
  const groupId = randomUUID();
  await logMove(c, { businessId, type: "break_down", variantId: kit.id, lotId: lot.id, from: b.fromLocationId, quantity: b.count, userId, groupId });
  await logMove(c, { businessId, type: "break_down", variantId: vial.rows[0].id, lotId: lot.id, to: to.id, quantity: vials, userId, groupId });
  return { vials, to: to.name, lot: lot.lot_number };
}

// ---- Transfer ----

export const transferInput = z.object({
  variantId: uuid, lotId: uuid, fromLocationId: uuid, toLocationId: uuid, quantity: qty,
});
export type TransferInput = z.infer<typeof transferInput>;

export async function transfer(c: PoolClient, businessId: string, userId: string, t: TransferInput) {
  if (t.fromLocationId === t.toLocationId) throw bad("Choose a different location to move to");
  const v = await getVariant(c, businessId, t.variantId);
  const lot = await getLot(c, businessId, t.lotId);
  if (lot.product_id !== v.product_id) throw bad("That lot belongs to a different product");
  const to = await checkLocation(c, t.toLocationId);
  await takeStock(c, v.id, lot.id, t.fromLocationId, t.quantity, plural(v.package_type));
  await addStock(c, v.id, lot.id, to.id, t.quantity);
  await logMove(c, { businessId, type: "transfer", variantId: v.id, lotId: lot.id, from: t.fromLocationId, to: to.id, quantity: t.quantity, userId });
  return { to: to.name };
}

const plural = (t: PackageType) => ({ kit: "kits", half_kit: "half kits", vial: "vials", unit: "units" })[t];

// ---- Adjustment ----

export const adjustInput = z
  .object({
    variantId: uuid, lotId: uuid, locationId: uuid,
    direction: z.enum(["add", "remove"]),
    quantity: qty,
    reason: z.enum(ADJUST_REASONS),
    note: z.string().trim().max(500).transform((s) => s || null),
  })
  .refine((a) => a.reason !== "other" || !!a.note, { message: "Add a note explaining the adjustment", path: ["note"] });
export type AdjustInput = z.infer<typeof adjustInput>;

/** Adds or removes stock with a reason. Removing can't take a line below zero. */
export async function adjust(c: PoolClient, businessId: string, userId: string, a: AdjustInput) {
  if (a.reason === "other" && !a.note) throw bad("Add a note explaining the adjustment");
  const v = await getVariant(c, businessId, a.variantId);
  const lot = await getLot(c, businessId, a.lotId);
  if (lot.product_id !== v.product_id) throw bad("That lot belongs to a different product");
  const loc = await checkLocation(c, a.locationId);
  if (a.direction === "remove") {
    await takeStock(c, v.id, lot.id, loc.id, a.quantity, plural(v.package_type));
  } else {
    await addStock(c, v.id, lot.id, loc.id, a.quantity);
  }
  await logMove(c, {
    businessId, type: "adjustment", variantId: v.id, lotId: lot.id,
    from: a.direction === "remove" ? loc.id : null, to: a.direction === "add" ? loc.id : null,
    quantity: a.quantity, reason: a.reason, userId, notes: a.note,
  });
}

// ---- Lots and testing ----

export const lotStatusInput = z.object({
  lotId: uuid,
  status: z.enum(LOT_STATUSES),
  note: z.string().trim().max(500).transform((s) => s || null),
});
export type LotStatusInput = z.infer<typeof lotStatusInput>;

/**
 * Sets a lot's testing result. From In testing a note is optional; changing a result that was already
 * Passed or Failed needs a note. Every change is kept in lot_status_changes.
 */
export async function setLotStatus(c: PoolClient, businessId: string, userId: string, s: LotStatusInput) {
  const lot = await getLot(c, businessId, s.lotId, true);
  if (lot.testing_status === s.status) return { changed: false, lot: lot.lot_number };
  if (lot.testing_status !== "in_testing" && !s.note) {
    throw bad(`Lot ${lot.lot_number} was already marked ${lot.testing_status === "passed" ? "Passed" : "Failed"}. Add a note saying why it's changing.`);
  }
  await c.query(
    `UPDATE lots SET testing_status = $2, status_changed_at = now(), status_changed_by = $3 WHERE id = $1`,
    [lot.id, s.status, userId]
  );
  await c.query(
    `INSERT INTO lot_status_changes (lot_id, from_status, to_status, note, changed_by) VALUES ($1, $2, $3, $4, $5)`,
    [lot.id, lot.testing_status, s.status, s.note, userId]
  );
  return { changed: true, lot: lot.lot_number };
}

/** Removes every unit of a failed lot (adjustment, reason "failed testing"), one movement per stock line. */
export async function writeOffLot(c: PoolClient, businessId: string, userId: string, lotId: string) {
  const lot = await getLot(c, businessId, lotId, true);
  if (lot.testing_status !== "failed") throw bad(`Only failed lots can be written off. Lot ${lot.lot_number} isn't marked Failed.`);
  const { rows } = await c.query(
    `SELECT s.id, s.variant_id, s.location_id, s.quantity, v.package_type
       FROM stock s JOIN variants v ON v.id = s.variant_id
      WHERE s.lot_id = $1 AND s.quantity > 0 FOR UPDATE OF s`,
    [lot.id]
  );
  if (!rows.length) throw bad(`Lot ${lot.lot_number} has no stock left to write off`);
  const groupId = randomUUID();
  const removed: Partial<Record<PackageType, number>> = {};
  for (const r of rows) {
    await c.query(`UPDATE stock SET quantity = 0, updated_at = now() WHERE id = $1`, [r.id]);
    await logMove(c, {
      businessId, type: "adjustment", variantId: r.variant_id, lotId: lot.id, from: r.location_id,
      quantity: r.quantity, reason: "failed_testing", userId, groupId, notes: "Lot failed testing, written off",
    });
    removed[r.package_type as PackageType] = (removed[r.package_type as PackageType] ?? 0) + r.quantity;
  }
  return { lot: lot.lot_number, removed };
}

