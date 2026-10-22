import { pool } from "@/lib/inventory/db";
import { foundationTests } from "./foundation.test";
import { weightTests } from "./weights.test";
import { importTests, productTests } from "./products.test";
import { operationTests } from "./operations.test";
import { alertTests } from "./alerts.test";

foundationTests()
  .then(() => weightTests())
  .then(() => productTests())
  .then(() => importTests())
  .then(() => operationTests())
  .then(() => alertTests())
  .then(() => pool.end())
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
