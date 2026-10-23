// Empties the TEST database and applies every migration, so `npm run test:inventory` starts clean.
// Refuses to run unless DATABASE_URL points at a local database whose name contains "test".
// Usage: DATABASE_URL=postgresql://postgres@localhost:5433/inventory_test node scripts/reset-test-db.mjs
import { execSync } from "node:child_process";
import pg from "pg";

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("Set DATABASE_URL to the throwaway test database first.");
  process.exit(1);
}
const url = new URL(raw);
const name = url.pathname.replace(/^\//, "");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
if (!local || !/test/i.test(name)) {
  console.error(`Refusing to reset "${name}" on ${url.hostname}: only local databases with "test" in the name can be reset.`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: raw });
await client.connect();
await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await client.end();
execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
console.log(`Reset ${name}.`);
