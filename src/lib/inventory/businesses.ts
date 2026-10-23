import { pool } from "./db";

export type BusinessSummary = { id: string; name: string };

/**
 * Owners are the site's Admin users. Only they can add businesses, choose managers, create accounts for new
 * managers and create or revoke website API keys. Checked against the database on every request, so removing
 * someone's Admin role takes effect straight away.
 */
export async function isOwner(userId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT role FROM "User" WHERE id = $1`, [userId]);
  return rows[0]?.role === "ADMIN";
}

/** True if this user is a manager of the given (active) business. */
export async function userCanManage(userId: string, businessId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM business_users bu
       JOIN businesses b ON b.id = bu.business_id
      WHERE bu.user_id = $1 AND bu.business_id = $2 AND b.is_active`,
    [userId, businessId]
  );
  return (rowCount ?? 0) > 0;
}

/** Active businesses this user manages, alphabetically. */
export async function listManagedBusinesses(userId: string): Promise<BusinessSummary[]> {
  const { rows } = await pool.query(
    `SELECT b.id, b.name
       FROM business_users bu
       JOIN businesses b ON b.id = bu.business_id
      WHERE bu.user_id = $1 AND b.is_active
      ORDER BY b.name`,
    [userId]
  );
  return rows;
}

/**
 * The business the user last switched to, if they still manage it;
 * otherwise their first business. Null if they manage none.
 */
export async function resolveActiveBusiness(
  userId: string,
  managed: BusinessSummary[]
): Promise<BusinessSummary | null> {
  if (managed.length === 0) return null;
  const { rows } = await pool.query(
    `SELECT active_business_id FROM user_preferences WHERE user_id = $1`,
    [userId]
  );
  const preferred = rows[0]?.active_business_id as string | undefined;
  return managed.find((b) => b.id === preferred) ?? managed[0];
}

/** Saves the user's choice. Returns false (and saves nothing) if they don't manage that business. */
export async function setActiveBusiness(userId: string, businessId: string): Promise<boolean> {
  if (!(await userCanManage(userId, businessId))) return false;
  await pool.query(
    `INSERT INTO user_preferences (user_id, active_business_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET active_business_id = EXCLUDED.active_business_id, updated_at = now()`,
    [userId, businessId]
  );
  return true;
}
