import type { PoolClient } from "pg";
import { z } from "zod";
import { InboundError } from "./errors";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  FORM_LABEL,
  FORMS_FOR_CATEGORY,
  MAX_PRIORITY,
  PACKAGE_TYPES,
  UNITS_PER_PACKAGE,
  type Category,
  type PackageType,
} from "./product-meta";

// ---- Input rules, shared by the screens and bulk import ----

export const skuSchema = z
  .string()
  .trim()
  .min(1, "Enter the website SKU")
  .max(100, "SKU is too long (100 characters max)")
  .regex(/^\S+$/, "SKUs can't contain spaces");

export const variantInput = z.object({
  packageType: z.enum(PACKAGE_TYPES),
  sku: skuSchema,
  homeLocationId: z.string().uuid().nullable(),
  minLevel: z.number().int("Min level must be a whole number").min(0, "Min level can't be negative").max(100000),
});
export type VariantInput = z.infer<typeof variantInput>;

export const productFields = z.object({
  name: z.string().trim().min(1, "Enter the product name").max(200),
  strengthSize: z
    .string()
    .trim()
    .max(50)
    .transform((s) => s || null),
  category: z.enum(CATEGORIES),
  vialWeightG: z.number().positive("Vial weight must be more than 0").max(99999).nullable(),
});
export type ProductFields = z.infer<typeof productFields>;

export const newProductInput = productFields.extend({
  isPriority: z.boolean(),
  variants: z.array(variantInput).min(1, "Add at least one form with its SKU").max(4),
});
export type NewProductInput = z.infer<typeof newProductInput>;

// ---- Checks ----

const bad = (message: string) => new InboundError(400, message);

function checkForms(category: Category, variants: { packageType: PackageType }[]) {
  const allowed = FORMS_FOR_CATEGORY[category];
  const seen = new Set<PackageType>();
  for (const v of variants) {
    if (!allowed.includes(v.packageType)) {
      throw bad(`${CATEGORY_LABEL[category]} products can't be sold as "${FORM_LABEL[v.packageType]}"`);
    }
    if (seen.has(v.packageType)) throw bad(`"${FORM_LABEL[v.packageType]}" is listed twice`);
    seen.add(v.packageType);
  }
}

async function checkSkusFree(c: PoolClient, businessId: string, skus: string[], exceptVariantId?: string) {
  const dup = skus.find((s, i) => skus.indexOf(s) !== i);
  if (dup) throw bad(`SKU "${dup}" is used twice`);
  const { rows } = await c.query(
    `SELECT v.sku, p.name, p.strength_size FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.business_id = $1 AND v.sku = ANY($2) AND ($3::uuid IS NULL OR v.id <> $3)`,
    [businessId, skus, exceptVariantId ?? null]
  );
  if (rows[0]) {
    const owner = [rows[0].name, rows[0].strength_size].filter(Boolean).join(" ");
    throw bad(`SKU "${rows[0].sku}" is already used by ${owner}`);
  }
}

async function checkLocations(c: PoolClient, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return;
  const { rowCount } = await c.query(`SELECT 1 FROM locations WHERE id = ANY($1) AND is_active`, [wanted]);
  if (rowCount !== wanted.length) throw bad("Choose a home location from the list");
}

/**
 * Locks the business row so two managers can't both take the last priority slot,
 * then refuses if the business already has MAX_PRIORITY priority products.
 */
async function checkPriorityRoom(c: PoolClient, businessId: string, exceptProductId?: string) {
  await c.query(`SELECT 1 FROM businesses WHERE id = $1 FOR UPDATE`, [businessId]);
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM products
      WHERE business_id = $1 AND is_priority AND ($2::uuid IS NULL OR id <> $2)`,
    [businessId, exceptProductId ?? null]
  );
  if (rows[0].n >= MAX_PRIORITY) {
    throw bad(`There are already ${MAX_PRIORITY} priority products. Un-mark one before adding another.`);
  }
}

async function getProduct(c: PoolClient, businessId: string, productId: string) {
  const { rows } = await c.query(
    `SELECT id, category, is_priority FROM products WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [productId, businessId]
  );
  if (!rows[0]) throw new InboundError(404, "That product isn't in this business");
  return rows[0] as { id: string; category: Category; is_priority: boolean };
}

// ---- Changes (each runs inside the caller's withTransaction) ----

export async function createProduct(c: PoolClient, businessId: string, userId: string, input: NewProductInput) {
  checkForms(input.category, input.variants);
  await checkSkusFree(c, businessId, input.variants.map((v) => v.sku));
  await checkLocations(c, input.variants.map((v) => v.homeLocationId));
  if (input.isPriority) await checkPriorityRoom(c, businessId);

  const { rows } = await c.query(
    `INSERT INTO products (business_id, name, category, strength_size, is_priority,
                           vial_weight_g, vial_weight_updated_at, vial_weight_updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, CASE WHEN $6::numeric IS NULL THEN NULL ELSE now() END,
             CASE WHEN $6::numeric IS NULL THEN NULL ELSE $7 END)
     RETURNING id`,
    [businessId, input.name, input.category, input.strengthSize, input.isPriority, input.vialWeightG, userId]
  );
  const productId: string = rows[0].id;
  for (const v of input.variants) await insertVariant(c, businessId, productId, v);
  return productId;
}

async function insertVariant(c: PoolClient, businessId: string, productId: string, v: VariantInput) {
  await c.query(
    `INSERT INTO variants (business_id, product_id, package_type, units_per_package, sku, home_location_id, min_level)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [businessId, productId, v.packageType, UNITS_PER_PACKAGE[v.packageType], v.sku, v.homeLocationId, v.minLevel]
  );
}

/** Name, strength, category and vial weight. Category can only change if the existing forms still fit. */
export async function updateProduct(c: PoolClient, businessId: string, userId: string, productId: string, f: ProductFields) {
  await getProduct(c, businessId, productId);
  const forms = await c.query(`SELECT package_type AS "packageType" FROM variants WHERE product_id = $1`, [productId]);
  const misfit = forms.rows.find((r) => !FORMS_FOR_CATEGORY[f.category].includes(r.packageType));
  if (misfit) {
    throw bad(`A ${CATEGORY_LABEL[f.category]} product can't have a "${FORM_LABEL[misfit.packageType as PackageType]}" form`);
  }
  await c.query(
    `UPDATE products
        SET name = $3, strength_size = $4, category = $5, updated_at = now(),
            vial_weight_updated_at = CASE WHEN vial_weight_g IS DISTINCT FROM $6::numeric THEN now() ELSE vial_weight_updated_at END,
            vial_weight_updated_by = CASE WHEN vial_weight_g IS DISTINCT FROM $6::numeric THEN $7 ELSE vial_weight_updated_by END,
            vial_weight_g = $6::numeric
      WHERE id = $1 AND business_id = $2`,
    [productId, businessId, f.name, f.strengthSize, f.category, f.vialWeightG, userId]
  );
}

export async function setPriority(c: PoolClient, businessId: string, productId: string, on: boolean) {
  const p = await getProduct(c, businessId, productId);
  if (on && !p.is_priority) await checkPriorityRoom(c, businessId, productId);
  await c.query(`UPDATE products SET is_priority = $3, updated_at = now() WHERE id = $1 AND business_id = $2`, [
    productId, businessId, on,
  ]);
}

/** Switching a product off hides it from lists. Its history and stock stay; nothing is deleted. */
export async function setProductActive(c: PoolClient, businessId: string, productId: string, on: boolean) {
  await getProduct(c, businessId, productId);
  await c.query(`UPDATE products SET is_active = $3, updated_at = now() WHERE id = $1 AND business_id = $2`, [
    productId, businessId, on,
  ]);
}

export async function addVariant(c: PoolClient, businessId: string, productId: string, v: VariantInput) {
  const p = await getProduct(c, businessId, productId);
  const existing = await c.query(`SELECT package_type AS "packageType" FROM variants WHERE product_id = $1`, [productId]);
  checkForms(p.category, [...existing.rows, v]);
  await checkSkusFree(c, businessId, [v.sku]);
  await checkLocations(c, [v.homeLocationId]);
  await insertVariant(c, businessId, productId, v);
}

export const variantUpdate = z.object({
  sku: skuSchema,
  homeLocationId: z.string().uuid().nullable(),
  minLevel: variantInput.shape.minLevel,
  isActive: z.boolean(),
});
export type VariantUpdate = z.infer<typeof variantUpdate>;

async function getVariant(c: PoolClient, businessId: string, variantId: string) {
  const { rows } = await c.query(
    `SELECT id, product_id FROM variants WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [variantId, businessId]
  );
  if (!rows[0]) throw new InboundError(404, "That form isn't in this business");
  return rows[0] as { id: string; product_id: string };
}

/**
 * SKU, home location, min level and on/off for one form.
 * A changed SKU must match what the website sends from now on, or its orders will be flagged as unknown SKUs.
 */
export async function updateVariant(c: PoolClient, businessId: string, variantId: string, u: VariantUpdate) {
  await getVariant(c, businessId, variantId);
  await checkSkusFree(c, businessId, [u.sku], variantId);
  await checkLocations(c, [u.homeLocationId]);
  await c.query(
    `UPDATE variants SET sku = $3, home_location_id = $4, min_level = $5, is_active = $6, updated_at = now()
      WHERE id = $1 AND business_id = $2`,
    [variantId, businessId, u.sku, u.homeLocationId, u.minLevel, u.isActive]
  );
}

export async function setMinLevel(c: PoolClient, businessId: string, variantId: string, minLevel: number) {
  await getVariant(c, businessId, variantId);
  await c.query(`UPDATE variants SET min_level = $3, updated_at = now() WHERE id = $1 AND business_id = $2`, [
    variantId, businessId, minLevel,
  ]);
}
