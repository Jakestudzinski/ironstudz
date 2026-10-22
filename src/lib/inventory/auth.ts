import { createHash, randomBytes } from "crypto";
import { pool } from "./db";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generates a new key. Show it once, store only hashApiKey(key). */
export function generateApiKey(): string {
  return "inv_" + randomBytes(32).toString("hex");
}

/**
 * Reads "Authorization: Bearer <key>" and returns the business the key belongs to.
 * The key alone decides the business, so a caller can never write into another business.
 */
export async function authenticateBusiness(req: Request): Promise<{ businessId: string } | null> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const key = header.slice(7).trim();
  if (!key) return null;

  const { rows } = await pool.query(
    `SELECT k.business_id
       FROM api_keys k
       JOIN businesses b ON b.id = k.business_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND b.is_active`,
    [hashApiKey(key)]
  );
  return rows[0] ? { businessId: rows[0].business_id } : null;
}
