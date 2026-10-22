"use server";

import { z } from "zod";
import { runChange, type ActionResult } from "@/lib/inventory/run-change";
import {
  addVariant, createProduct, newProductInput, productFields, setMinLevel, setPriority, setProductActive,
  updateProduct, updateVariant, variantInput, variantUpdate,
} from "@/lib/inventory/product-changes";

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";
const id = z.string().uuid();

export async function createProductAction(input: unknown): Promise<ActionResult<string>> {
  const parsed = newProductInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return runChange((c, b, u) => createProduct(c, b, u, parsed.data));
}

const editInput = z.object({
  productId: id,
  fields: productFields,
  variants: z.array(variantUpdate.extend({ id })).max(4),
  newVariants: z.array(variantInput).max(4),
});

/** Saves the Edit product form: product details, every existing form, and any forms added — all or nothing. */
export async function updateProductAction(input: unknown): Promise<ActionResult> {
  const parsed = editInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const d = parsed.data;
  return runChange(async (c, b, u) => {
    await updateProduct(c, b, u, d.productId, d.fields);
    for (const { id: variantId, ...v } of d.variants) await updateVariant(c, b, variantId, v);
    for (const v of d.newVariants) await addVariant(c, b, d.productId, v);
  });
}

export async function setPriorityAction(productId: string, on: boolean): Promise<ActionResult> {
  if (!id.safeParse(productId).success) return { ok: false, message: "Unknown product" };
  return runChange((c, b) => setPriority(c, b, productId, !!on));
}

export async function setActiveAction(productId: string, on: boolean): Promise<ActionResult> {
  if (!id.safeParse(productId).success) return { ok: false, message: "Unknown product" };
  return runChange((c, b) => setProductActive(c, b, productId, !!on));
}

export async function setMinLevelAction(variantId: string, minLevel: number): Promise<ActionResult> {
  const parsed = z.object({ variantId: id, minLevel: variantInput.shape.minLevel }).safeParse({ variantId, minLevel });
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return runChange((c, b) => setMinLevel(c, b, parsed.data.variantId, parsed.data.minLevel));
}
