import { pool } from "@/lib/inventory/db";
import { foundationTests } from "./foundation.test";
import { weightTests } from "./weights.test";

foundationTests()
  .then(() => weightTests())
  .then(() => pool.end())
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
