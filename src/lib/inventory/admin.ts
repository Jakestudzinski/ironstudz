import type { PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { z } from "zod";
import { pool } from "./db";
import { InboundError } from "./errors";
import { generateApiKey, hashApiKey } from "./auth";
import { CATEGORIES } from "./product-meta";

// Owner (site Admin) tools: businesses, their managers and their website API keys.
// Every function here must only be called after isOwner() / requireOwner().

const bad = (m: string) => new InboundError(400, m);

export type BusinessCard = {
  id: string;
  name: string;
  sells: string | null;
  isActive: boolean;
  products: number;
  managers: { id: string; name: string; email: string | null }[];
  keys: { id: string; label: string; createdAt: string; revokedAt: string | null }[];
};

/** Every business (owners see all of them, not only the ones they manage). */
export async function listAllBusinesses(): Promise<BusinessCard[]> {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.sells, b.is_active AS "isActive",
            (SELECT count(*) FROM products p WHERE p.business_id = b.id AND p.is_active)::int AS products,
            coalesce((SELECT json_agg(json_build_object('id', bu.user_id, 'name', coalesce(u.name, u.email, bu.user_id), 'email', u.email)
                                ORDER BY coalesce(u.name, u.email, bu.user_id))
                        FROM business_users bu LEFT JOIN "User" u ON u.id = bu.user_id WHERE bu.business_id = b.id), '[]') AS managers,
            coalesce((SELECT json_agg(json_build_object('id', k.id, 'label', k.label, 'createdAt', k.created_at, 'revokedAt', k.revoked_at)
                                ORDER BY k.created_at DESC)
                        FROM api_keys k WHERE k.business_id = b.id), '[]') AS keys
       FROM businesses b
      ORDER BY b.is_active DESC, b.name`
  );
  return rows;
}

export const newBusinessInput = z.object({
  name: z.string().trim().min(1, "Enter the business name").max(100),
  sells: z.enum(CATEGORIES),
  createKey: z.boolean(),
});

/** Creates a business with its alert settings; the owner who made it becomes its first manager. */
export async function createBusiness(c: PoolClient, ownerId: string, input: z.infer<typeof newBusinessInput>) {
  const dup = await c.query(`SELECT 1 FROM businesses WHERE lower(name) = lower($1)`, [input.name]);
  if (dup.rowCount) throw bad(`There's already a business called “${input.name}”`);
  const { rows } = await c.query(`INSERT INTO businesses (name, sells) VALUES ($1, $2) RETURNING id`, [input.name, input.sells]);
  const businessId: string = rows[0].id;
  await c.query(`INSERT INTO alert_settings (business_id) VALUES ($1)`, [businessId]);
  await c.query(`INSERT INTO business_users (business_id, user_id) VALUES ($1, $2)`, [businessId, ownerId]);
  const key = input.createKey ? await createApiKey(c, businessId, "Website") : null;
  return { businessId, key };
}

export async function setBusinessActive(c: PoolClient, businessId: string, on: boolean) {
  const r = await c.query(`UPDATE businesses SET is_active = $2 WHERE id = $1`, [businessId, on]);
  if (!r.rowCount) throw new InboundError(404, "Unknown business");
}

/**
 * Adds a manager by email. If they don't have a site account yet, one is created with a temporary password
 * that's returned once so the owner can pass it on (there's no public sign-up).
 */
export async function addManager(c: PoolClient, businessId: string, email: string, name: string | null) {
  const biz = await c.query(`SELECT 1 FROM businesses WHERE id = $1`, [businessId]);
  if (!biz.rowCount) throw new InboundError(404, "Unknown business");
  const normalized = email.trim().toLowerCase();
  let user = (await c.query(`SELECT id, coalesce(name, email) AS name FROM "User" WHERE lower(email) = $1`, [normalized])).rows[0];
  let tempPassword: string | null = null;
  if (!user) {
    tempPassword = randomBytes(9).toString("base64url");
    const hash = await bcrypt.hash(tempPassword, 12);
    const id = "c" + randomBytes(12).toString("hex");
    user = (await c.query(
      `INSERT INTO "User" (id, name, email, "passwordHash", role, "updatedAt") VALUES ($1, $2, $3, $4, 'USER', now())
       RETURNING id, coalesce(name, email) AS name`,
      [id, name?.trim() || null, normalized, hash]
    )).rows[0];
  }
  const added = await c.query(
    `INSERT INTO business_users (business_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [businessId, user.id]
  );
  if (!added.rowCount) throw bad(`${user.name} is already a manager of this business`);
  return { userId: user.id as string, name: user.name as string, tempPassword };
}

export async function removeManager(c: PoolClient, businessId: string, userId: string) {
  const r = await c.query(`DELETE FROM business_users WHERE business_id = $1 AND user_id = $2`, [businessId, userId]);
  if (!r.rowCount) throw bad("That person isn't a manager of this business");
  // Forget their business switcher choice if it pointed here.
  await c.query(`UPDATE user_preferences SET active_business_id = NULL WHERE user_id = $1 AND active_business_id = $2`, [userId, businessId]);
}

/** Makes a key for a business's website. Only the hash is stored; the key itself is returned once. */
export async function createApiKey(c: PoolClient, businessId: string, label: string) {
  const biz = await c.query(`SELECT 1 FROM businesses WHERE id = $1`, [businessId]);
  if (!biz.rowCount) throw new InboundError(404, "Unknown business");
  const clean = label.trim().slice(0, 60) || "Website";
  const key = generateApiKey();
  await c.query(`INSERT INTO api_keys (business_id, key_hash, label) VALUES ($1, $2, $3)`, [businessId, hashApiKey(key), clean]);
  return key;
}

export async function revokeApiKey(c: PoolClient, businessId: string, keyId: string) {
  const r = await c.query(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND business_id = $2 AND revoked_at IS NULL`, [keyId, businessId]
  );
  if (!r.rowCount) throw bad("That key is already revoked or isn't for this business");
}
