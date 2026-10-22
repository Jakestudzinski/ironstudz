import { pool } from "./db";

/** Records every inbound request. Never throws, so logging can't break a request. */
export async function logInbound(entry: {
  endpoint: string;
  statusCode: number;
  businessId?: string | null;
  reference?: string | null;
  payload?: unknown;
  error?: string | null;
}) {
  try {
    await pool.query(
      `INSERT INTO inbound_requests (business_id, endpoint, reference, status_code, payload, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.businessId ?? null,
        entry.endpoint,
        entry.reference ?? null,
        entry.statusCode,
        entry.payload === undefined ? null : JSON.stringify(entry.payload),
        entry.error ?? null,
      ]
    );
  } catch (err) {
    console.error("inbound log failed", err);
  }
}
