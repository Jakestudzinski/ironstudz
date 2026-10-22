import pg from "pg";
import type { PoolClient } from "pg";

const { Pool } = pg;

// Reuse one pool across hot reloads in development.
const globalForPg = globalThis as unknown as { inventoryPool?: pg.Pool };

export const pool =
  globalForPg.inventoryPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForPg.inventoryPool = pool;

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
