import { pool } from "./db";

// Rate limits for the inbound API, counted in PostgreSQL so they hold across every server instance.
// Generous on purpose: a real store sends a few orders a minute. They're there to stop a runaway script
// or someone guessing keys. If the counter itself fails, the request is allowed (orders must not be lost
// because of the limiter).

export const LIMITS = {
  /** Requests per minute from one IP address, before the key is even checked. */
  perIp: { max: 300, windowSeconds: 60 },
  /** Orders and cancellations per minute for one business (its key). */
  perBusiness: { max: 120, windowSeconds: 60 },
  /** Wrong or missing keys from one IP in 10 minutes before that IP is refused outright. */
  badKeys: { max: 20, windowSeconds: 600 },
  /** Deliveries per minute recorded by one signed-in manager. */
  perUser: { max: 60, windowSeconds: 60 },
} as const;

export type Limit = { max: number; windowSeconds: number };
export type LimitResult = { allowed: boolean; count: number; retryAfter: number };

const windowStart = (now: number, seconds: number) => Math.floor(now / 1000 / seconds) * seconds;

/** Counts one request in this bucket's current window. */
export async function hit(bucket: string, limit: Limit, now = Date.now()): Promise<LimitResult> {
  const start = windowStart(now, limit.windowSeconds);
  const retryAfter = Math.max(1, start + limit.windowSeconds - Math.floor(now / 1000));
  try {
    const { rows } = await pool.query(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES ($1, to_timestamp($2), 1)
       ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [bucket, start]
    );
    // Now and then, clear out windows that ended more than a day ago.
    if (Math.random() < 0.01) await pool.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
    const count: number = rows[0].count;
    return { allowed: count <= limit.max, count, retryAfter };
  } catch (err) {
    console.error("rate limit check failed; allowing the request", err);
    return { allowed: true, count: 0, retryAfter: 0 };
  }
}

/** Reads a bucket's current count without adding to it. */
export async function peek(bucket: string, limit: Limit, now = Date.now()): Promise<LimitResult> {
  const start = windowStart(now, limit.windowSeconds);
  const retryAfter = Math.max(1, start + limit.windowSeconds - Math.floor(now / 1000));
  try {
    const { rows } = await pool.query(
      `SELECT count FROM rate_limits WHERE bucket = $1 AND window_start = to_timestamp($2)`, [bucket, start]
    );
    const count: number = rows[0]?.count ?? 0;
    return { allowed: count < limit.max, count, retryAfter };
  } catch {
    return { allowed: true, count: 0, retryAfter: 0 };
  }
}

/** The caller's IP address as Vercel (or another proxy) reports it. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim().slice(0, 64);
}
