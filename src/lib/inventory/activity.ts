import { pool } from "./db";
import { REASON_LABEL, type AdjustReason } from "./operation-labels";
import type { PackageType } from "./product-meta";

export type ActivityItem = { id: string; at: string; who: string; text: string };

const FORM = { kit: ["kit", "kits"], half_kit: ["half kit", "half kits"], vial: ["vial", "vials"], unit: ["unit", "units"] } as const;
const n = (q: number, t: PackageType) => `${q} ${FORM[t][q === 1 ? 0 : 1]}`;
const STATUS = { passed: "Passed", failed: "Failed", in_testing: "back to In testing" } as const;

/**
 * The latest stock changes and lot results for one business, newest first, in plain words.
 * A break down (two linked movements) and a lot write-off show as one line each.
 */
export async function recentActivity(businessId: string, limit = 10): Promise<ActivityItem[]> {
  const moves = await pool.query(
    `SELECT m.id::text, m.created_at, m.movement_type AS type, m.quantity, m.reason, m.order_ref, m.notes, m.group_id,
            v.package_type, trim(p.name || ' ' || coalesce(p.strength_size, '')) AS product, l.lot_number,
            lf.name AS "from", lt.name AS "to",
            CASE WHEN m.user_id IS NULL THEN 'Website' ELSE coalesce(u.name, u.email, 'Manager') END AS who
       FROM movements m
       JOIN variants v ON v.id = m.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN lots l ON l.id = m.lot_id
       LEFT JOIN locations lf ON lf.id = m.from_location_id
       LEFT JOIN locations lt ON lt.id = m.to_location_id
       LEFT JOIN "User" u ON u.id = m.user_id
      WHERE m.business_id = $1
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2`,
    [businessId, limit * 4]
  );
  const results = await pool.query(
    `SELECT c.id::text, c.changed_at AS created_at, c.to_status, c.note, l.lot_number,
            trim(p.name || ' ' || coalesce(p.strength_size, '')) AS product, coalesce(u.name, u.email, 'Manager') AS who
       FROM lot_status_changes c
       JOIN lots l ON l.id = c.lot_id
       JOIN products p ON p.id = l.product_id
       LEFT JOIN "User" u ON u.id = c.changed_by
      WHERE p.business_id = $1
      ORDER BY c.changed_at DESC, c.id DESC
      LIMIT $2`,
    [businessId, limit]
  );

  const items: ActivityItem[] = [];
  const seenGroups = new Set<string>();
  for (const m of moves.rows) {
    const at = new Date(m.created_at).toISOString();
    if (m.type === "break_down") {
      if (seenGroups.has(m.group_id)) continue;
      seenGroups.add(m.group_id);
      const pair = moves.rows.filter((x) => x.group_id === m.group_id);
      const opened = pair.find((x) => x.from) ?? m;
      const into = pair.find((x) => x.to);
      items.push({
        id: `m${m.id}`, at, who: m.who,
        text: `Broke down ${n(opened.quantity, opened.package_type)} of ${m.product} · ${opened.from}${into ? ` → ${into.to}` : ""}`,
      });
      continue;
    }
    if (m.type === "adjustment" && m.reason === "failed_testing" && m.group_id) {
      if (seenGroups.has(m.group_id)) continue;
      seenGroups.add(m.group_id);
      items.push({ id: `m${m.id}`, at, who: m.who, text: `Wrote off lot ${m.lot_number} of ${m.product} · failed testing` });
      continue;
    }
    const text =
      m.type === "sold" ? `Sold ${m.product} ${FORM[m.package_type as PackageType][0]} × ${m.quantity}${m.order_ref ? ` · Order ${m.order_ref}` : ""}` :
      m.type === "received" ? `Received lot ${m.lot_number} · ${m.product} · ${n(m.quantity, m.package_type)}${m.to ? ` → ${m.to}` : ""}` :
      m.type === "transfer" ? `Moved ${n(m.quantity, m.package_type)} of ${m.product} · ${m.from} → ${m.to}` :
      `Adjustment · ${m.product} ${m.to ? "+" : "−"}${n(m.quantity, m.package_type)} · ${(REASON_LABEL[m.reason as AdjustReason] ?? "adjustment").toLowerCase()}${m.notes ? ` · ${m.notes}` : ""}`;
    items.push({ id: `m${m.id}`, at, who: m.who, text });
  }
  for (const r of results.rows) {
    items.push({
      id: `s${r.id}`, at: new Date(r.created_at).toISOString(), who: r.who,
      text: `Marked lot ${r.lot_number} (${r.product}) ${STATUS[r.to_status as keyof typeof STATUS]}${r.note ? ` · ${r.note}` : ""}`,
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
