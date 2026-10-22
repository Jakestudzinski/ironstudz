import { pool } from "./db";
import { REASON_LABEL, type AdjustReason } from "./operation-labels";
import type { PackageType } from "./product-meta";

import { TYPE_LABEL, type MovementType } from "./movement-labels";
export { MOVEMENT_TYPES, TYPE_LABEL, type MovementType } from "./movement-labels";

export type MovementFilters = {
  /** Phoenix calendar days, YYYY-MM-DD, both inclusive. */
  from?: string;
  to?: string;
  type?: MovementType;
  productId?: string;
  /** "website" for paid orders, or a user id. */
  who?: string;
  orderRef?: string;
};

export type MovementRow = {
  id: string;
  at: string;
  type: MovementType;
  product: string;
  productId: string;
  packageType: PackageType;
  sku: string;
  lotNumber: string;
  from: string | null;
  to: string | null;
  /** Positive when stock was added somewhere (received, added back), negative when it left (sold, removed). */
  change: number;
  quantity: number;
  reason: string | null;
  orderRef: string | null;
  who: string;
  notes: string | null;
};

export const PAGE_SIZE = 50;

function where(businessId: string, f: MovementFilters) {
  const clauses = ["m.business_id = $1"];
  const params: unknown[] = [businessId];
  const add = (sql: string, v: unknown) => { params.push(v); clauses.push(sql.replace("?", `$${params.length}`)); };
  // Days are Phoenix days: from midnight Phoenix on `from` to midnight after `to`.
  if (f.from) add(`m.created_at >= (?::date)::timestamp AT TIME ZONE 'America/Phoenix'`, f.from);
  if (f.to) add(`m.created_at < (?::date + 1)::timestamp AT TIME ZONE 'America/Phoenix'`, f.to);
  if (f.type) add(`m.movement_type = ?`, f.type);
  if (f.productId) add(`v.product_id = ?`, f.productId);
  if (f.who === "website") clauses.push(`m.user_id IS NULL`);
  else if (f.who) add(`m.user_id = ?`, f.who);
  if (f.orderRef?.trim()) add(`m.order_ref ILIKE ?`, `%${f.orderRef.trim()}%`);
  return { sql: clauses.join(" AND "), params };
}

const SELECT = `
  SELECT m.id::text, m.created_at AS at, m.movement_type AS type,
         trim(p.name || ' ' || coalesce(p.strength_size, '')) AS product, p.id AS "productId",
         v.package_type AS "packageType", v.sku, l.lot_number AS "lotNumber",
         lf.name AS "from", lt.name AS "to", m.quantity, m.reason, m.order_ref AS "orderRef", m.notes,
         CASE WHEN m.user_id IS NULL THEN 'Website' ELSE coalesce(u.name, u.email, m.user_id) END AS who
    FROM movements m
    JOIN variants v ON v.id = m.variant_id
    JOIN products p ON p.id = v.product_id
    JOIN lots l ON l.id = m.lot_id
    LEFT JOIN locations lf ON lf.id = m.from_location_id
    LEFT JOIN locations lt ON lt.id = m.to_location_id
    LEFT JOIN "User" u ON u.id = m.user_id`;

function shape(r: Record<string, unknown>): MovementRow {
  const row = r as unknown as MovementRow & { at: Date };
  // A transfer moves stock without changing the total; everything else adds (has a "to") or removes.
  const change = row.type === "transfer" ? 0 : row.to ? row.quantity : -row.quantity;
  return { ...row, at: new Date(row.at).toISOString(), change };
}

/** One page of the permanent movement log, newest first, with the total number of matches. */
export async function listMovements(businessId: string, f: MovementFilters, page = 1) {
  const w = where(businessId, f);
  const total = await pool.query(
    `SELECT count(*)::int AS n FROM movements m JOIN variants v ON v.id = m.variant_id WHERE ${w.sql}`,
    w.params
  );
  const { rows } = await pool.query(
    `${SELECT} WHERE ${w.sql} ORDER BY m.created_at DESC, m.id DESC LIMIT ${PAGE_SIZE} OFFSET $${w.params.length + 1}`,
    [...w.params, (Math.max(1, page) - 1) * PAGE_SIZE]
  );
  return { rows: rows.map(shape), total: total.rows[0].n as number };
}

/** Every matching movement, oldest first, for the CSV download (capped so a file stays a sensible size). */
export async function allMovements(businessId: string, f: MovementFilters, cap = 50000) {
  const w = where(businessId, f);
  const { rows } = await pool.query(`${SELECT} WHERE ${w.sql} ORDER BY m.created_at, m.id LIMIT ${cap}`, w.params);
  return rows.map(shape);
}

/** People who have made stock changes in this business, for the "Who" filter. */
export async function listMovementUsers(businessId: string) {
  const { rows } = await pool.query(
    `SELECT DISTINCT m.user_id AS id, coalesce(u.name, u.email, m.user_id) AS name
       FROM movements m LEFT JOIN "User" u ON u.id = m.user_id
      WHERE m.business_id = $1 AND m.user_id IS NOT NULL
      ORDER BY 2`,
    [businessId]
  );
  return rows as { id: string; name: string }[];
}

const phoenix = (iso: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote when needed; a leading = + - @ is prefixed so spreadsheets don't run it as a formula.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function movementsCsv(rows: MovementRow[]): string {
  const header = ["Date (Phoenix)", "Type", "Product", "Form", "SKU", "Lot", "From", "To", "Quantity", "Change", "Reason", "Order", "Who", "Notes"];
  const form = { kit: "Kit", half_kit: "Half kit", vial: "Vial", unit: "Unit" } as const;
  const lines = rows.map((r) => [
    phoenix(r.at), TYPE_LABEL[r.type], r.product, form[r.packageType], r.sku, r.lotNumber, r.from, r.to, r.quantity,
    r.change, r.reason ? REASON_LABEL[r.reason as AdjustReason] ?? r.reason : "", r.orderRef, r.who, r.notes,
  ].map(cell).join(","));
  // BOM so Excel opens it as UTF-8
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}
