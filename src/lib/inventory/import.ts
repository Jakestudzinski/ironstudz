import type { PoolClient } from "pg";
import { InboundError } from "./errors";
import {
  CATEGORY_LABEL,
  FORM_LABEL,
  FORMS_FOR_CATEGORY,
  MAX_PRIORITY,
  UNITS_PER_PACKAGE,
  type Category,
  type PackageType,
} from "./product-meta";
import { skuSchema } from "./product-changes";

/** Columns of the import file, in template order. */
export const IMPORT_COLUMNS = [
  "sku", "product", "strength", "category", "form", "home_location", "min_level", "priority", "vial_weight_g", "active",
] as const;

export const IMPORT_TEMPLATE =
  IMPORT_COLUMNS.join(",") + "\n" +
  "BPC15710MG-KIT,BPC-157,10mg,peptide,kit,Back 1,4,yes,5.25,yes\n" +
  "BPC15710MG-HALF,BPC-157,10mg,peptide,half kit,Back 1,2,,,\n" +
  "BPC15710MG-VIAL,BPC-157,10mg,peptide,vial,Rack A,20,,,\n" +
  "SERUM-30,Copper peptide serum,30ml,skin care,unit,D6,10,no,,yes\n";

export const MAX_IMPORT_ROWS = 2000;

/** Reads CSV text (commas, double-quoted fields, Excel's BOM and line endings) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type ImportAction = "new_product" | "new_form" | "update" | "error";

export type ImportRow = {
  line: number;
  sku: string;
  product: string;
  form: string;
  action: ImportAction;
  errors: string[];
};

export type ImportResult = {
  rows: ImportRow[];
  /** Problems with the file as a whole (missing columns, too many rows, priority limit). */
  fileErrors: string[];
  counts: { newProducts: number; newForms: number; updates: number; errors: number };
};

const CATEGORY_WORDS: Record<string, Category> = {
  peptide: "peptide", peptides: "peptide",
  "skin care": "skin_care", skin_care: "skin_care", skincare: "skin_care",
  "pre-workout": "pre_workout", pre_workout: "pre_workout", preworkout: "pre_workout", "pre workout": "pre_workout",
};
const FORM_WORDS: Record<string, PackageType> = {
  kit: "kit", "half kit": "half_kit", half_kit: "half_kit", half: "half_kit", halfkit: "half_kit",
  vial: "vial", unit: "unit",
};
const YES = new Set(["yes", "y", "true", "1"]);
const NO = new Set(["no", "n", "false", "0"]);

const yesNo = (v: string, column: string, errors: string[]): boolean | null => {
  const s = v.trim().toLowerCase();
  if (s === "") return null;
  if (YES.has(s)) return true;
  if (NO.has(s)) return false;
  errors.push(`${column} must be yes or no`);
  return null;
};

/**
 * Checks and writes every row. Always run inside a transaction: the preview runs the same code in a
 * transaction that is rolled back (`apply` false), so what you preview is exactly what gets imported.
 *
 * One row per form (SKU). Rows are matched on SKU: an existing SKU updates that form (and its product's
 * priority and vial weight); a new SKU is added to the product with the same name and strength, which is
 * created if it doesn't exist yet. Blank optional cells leave existing values unchanged.
 */
export async function runImport(
  c: PoolClient,
  businessId: string,
  userId: string,
  csv: string,
  apply: boolean
): Promise<ImportResult> {
  const table = parseCsv(csv);
  const fileErrors: string[] = [];
  const result = (rows: ImportRow[]): ImportResult => ({
    rows,
    fileErrors,
    counts: {
      newProducts: rows.filter((r) => r.action === "new_product").length,
      newForms: rows.filter((r) => r.action === "new_form").length,
      updates: rows.filter((r) => r.action === "update").length,
      errors: rows.filter((r) => r.action === "error").length,
    },
  });

  if (table.length < 2) {
    fileErrors.push("The file has no product rows. Start from the template.");
    return result([]);
  }
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(IMPORT_COLUMNS.map((name) => [name, header.indexOf(name)])) as Record<
    (typeof IMPORT_COLUMNS)[number], number
  >;
  const missing = (["sku", "product", "category", "form"] as const).filter((k) => col[k] < 0);
  if (missing.length) {
    fileErrors.push(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Start from the template.`);
    return result([]);
  }
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    fileErrors.push(`Too many rows (${table.length - 1}). Import at most ${MAX_IMPORT_ROWS} at a time.`);
    return result([]);
  }

  await c.query(`SELECT 1 FROM businesses WHERE id = $1 FOR UPDATE`, [businessId]);
  const locations = new Map(
    (await c.query(`SELECT id, lower(name) AS name FROM locations WHERE is_active`)).rows.map((r) => [r.name, r.id])
  );

  const rows: ImportRow[] = [];
  const seenSkus = new Map<string, number>();
  // Products created earlier in this file, so their other forms join them: key → id
  const createdProducts = new Map<string, string>();

  for (const [i, cells] of table.slice(1).entries()) {
    const line = i + 2;
    const get = (k: (typeof IMPORT_COLUMNS)[number]) => (col[k] >= 0 ? (cells[col[k]] ?? "").trim() : "");
    const errors: string[] = [];

    const skuParse = skuSchema.safeParse(get("sku"));
    const sku = skuParse.success ? skuParse.data : get("sku");
    if (!skuParse.success) errors.push(skuParse.error.issues[0].message);
    else if (seenSkus.has(sku)) errors.push(`SKU also on line ${seenSkus.get(sku)}`);
    else seenSkus.set(sku, line);

    const name = get("product");
    if (!name) errors.push("Enter the product name");
    if (name.length > 200) errors.push("Product name is too long");
    const strength = get("strength") || null;
    if (strength && strength.length > 50) errors.push("Strength is too long");

    const category = CATEGORY_WORDS[get("category").toLowerCase()];
    if (!category) errors.push("Category must be peptide, skin care or pre-workout");
    const packageType = FORM_WORDS[get("form").toLowerCase()];
    if (!packageType) errors.push("Form must be kit, half kit, vial or unit");
    if (category && packageType && !FORMS_FOR_CATEGORY[category].includes(packageType)) {
      errors.push(`${CATEGORY_LABEL[category]} products can't be sold as "${FORM_LABEL[packageType]}"`);
    }

    let homeLocationId: string | null | undefined;
    if (get("home_location")) {
      homeLocationId = locations.get(get("home_location").toLowerCase());
      if (!homeLocationId) errors.push(`Unknown location "${get("home_location")}"`);
    }
    let minLevel: number | undefined;
    if (get("min_level")) {
      minLevel = Number(get("min_level"));
      if (!/^\d{1,6}$/.test(get("min_level"))) errors.push("Min level must be a whole number, 0 or more");
    }
    let vialWeight: number | undefined;
    if (get("vial_weight_g")) {
      vialWeight = Number(get("vial_weight_g"));
      if (!/^\d{1,5}(\.\d{1,3})?$/.test(get("vial_weight_g")) || vialWeight <= 0) {
        errors.push("Vial weight must be grams above 0, e.g. 5.25");
      }
    }
    const priority = yesNo(get("priority"), "Priority", errors);
    const active = yesNo(get("active"), "Active", errors);

    const row: ImportRow = {
      line, sku, product: [name, strength].filter(Boolean).join(" "), form: packageType ? FORM_LABEL[packageType] : get("form"),
      action: "error", errors,
    };
    rows.push(row);
    if (errors.length) continue;

    const existing = await c.query(
      `SELECT v.id, v.product_id, v.package_type, p.name, p.strength_size, p.category
         FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.business_id = $1 AND v.sku = $2`,
      [businessId, sku]
    );

    if (existing.rows[0]) {
      const v = existing.rows[0];
      const sameProduct =
        v.name.toLowerCase() === name.toLowerCase() &&
        (v.strength_size ?? "").toLowerCase() === (strength ?? "").toLowerCase();
      if (!sameProduct) {
        const owner = [v.name, v.strength_size].filter(Boolean).join(" ");
        row.errors.push(`This SKU belongs to ${owner}. Rename products on their own page, not by import.`);
        continue;
      }
      if (v.package_type !== packageType) row.errors.push(`This SKU is the ${FORM_LABEL[v.package_type as PackageType]} form`);
      if (v.category !== category) row.errors.push(`This product is ${CATEGORY_LABEL[v.category as Category]}`);
      if (row.errors.length) continue;

      row.action = "update";
      await c.query(
        `UPDATE variants SET home_location_id = coalesce($2, home_location_id), min_level = coalesce($3, min_level),
                is_active = coalesce($4, is_active), updated_at = now()
          WHERE id = $1`,
        [v.id, homeLocationId ?? null, minLevel ?? null, active]
      );
      await updateProductFromRow(c, v.product_id, userId, priority, vialWeight);
      continue;
    }

    // New SKU: join an existing product with the same name and strength, or create one.
    const key = `${name.toLowerCase()}|${(strength ?? "").toLowerCase()}`;
    let productId = createdProducts.get(key);
    if (!productId) {
      const found = await c.query(
        `SELECT id, category FROM products
          WHERE business_id = $1 AND lower(name) = $2 AND lower(coalesce(strength_size, '')) = $3`,
        [businessId, name.toLowerCase(), (strength ?? "").toLowerCase()]
      );
      if (found.rows[0]) {
        if (found.rows[0].category !== category) {
          row.errors.push(`${row.product} already exists as ${CATEGORY_LABEL[found.rows[0].category as Category]}`);
          continue;
        }
        productId = found.rows[0].id as string;
      }
    }

    if (productId) {
      const forms = await c.query(`SELECT 1 FROM variants WHERE product_id = $1 AND package_type = $2`, [productId, packageType]);
      if (forms.rowCount) {
        row.errors.push(`${row.product} already has a ${FORM_LABEL[packageType]} form with a different SKU`);
        continue;
      }
      row.action = "new_form";
      await updateProductFromRow(c, productId, userId, priority, vialWeight);
    } else {
      row.action = "new_product";
      const created = await c.query(
        `INSERT INTO products (business_id, name, category, strength_size, is_priority, is_active,
                               vial_weight_g, vial_weight_updated_at, vial_weight_updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::numeric,
                 CASE WHEN $7::numeric IS NULL THEN NULL ELSE now() END, CASE WHEN $7::numeric IS NULL THEN NULL ELSE $8 END)
         RETURNING id`,
        [businessId, name, category, strength, priority ?? false, active ?? true, vialWeight ?? null, userId]
      );
      productId = created.rows[0].id as string;
      createdProducts.set(key, productId);
    }
    await c.query(
      `INSERT INTO variants (business_id, product_id, package_type, units_per_package, sku, home_location_id, min_level, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [businessId, productId, packageType, UNITS_PER_PACKAGE[packageType], sku, homeLocationId ?? null, minLevel ?? 0, active ?? true]
    );
  }

  for (const r of rows) if (r.errors.length) r.action = "error";

  const priorityCount = (
    await c.query(`SELECT count(*)::int AS n FROM products WHERE business_id = $1 AND is_priority`, [businessId])
  ).rows[0].n as number;
  if (priorityCount > MAX_PRIORITY) {
    fileErrors.push(
      `This would make ${priorityCount} priority products; the limit is ${MAX_PRIORITY}. Set priority to "no" on some rows.`
    );
  }

  const out = result(rows);
  if (apply && (out.counts.errors || fileErrors.length)) {
    // Undo everything: the caller's transaction rolls back on this error.
    throw new InboundError(400, "The file has errors. Nothing was imported.", out);
  }
  return out;
}

/** Applies a row's product-level cells (priority, vial weight). Blank cells leave values unchanged. */
async function updateProductFromRow(
  c: PoolClient, productId: string, userId: string, priority: boolean | null, vialWeight: number | undefined
) {
  if (priority !== null) await c.query(`UPDATE products SET is_priority = $2, updated_at = now() WHERE id = $1`, [productId, priority]);
  if (vialWeight !== undefined) {
    await c.query(
      `UPDATE products SET vial_weight_g = $2, vial_weight_updated_at = now(), vial_weight_updated_by = $3, updated_at = now()
        WHERE id = $1 AND vial_weight_g IS DISTINCT FROM $2::numeric`,
      [productId, vialWeight, userId]
    );
  }
}
