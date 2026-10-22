"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/inventory/context";
import { withTransaction } from "@/lib/inventory/db";
import { InboundError } from "@/lib/inventory/errors";
import {
  addVariant, createProduct, newProductInput, productFields, setMinLevel, setPriority, setProductActive,
  updateProduct, updateVariant, variantInput, variantUpdate,
} from "@/lib/inventory/product-changes";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

/** Runs a change for the manager's active business and turns expected errors into a message for the screen. */
async function run<T>(fn: (businessId: string, userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const { user, business } = await requireManager();
  try {
    const data = await fn(business.id, user.id);
    revalidatePath("/admin/inventory", "layout");
    return { ok: true, data };
  } catch (err) {
    if (err instanceof InboundError) return { ok: false, message: err.message };
    console.error("inventory product change failed", err);
    return { ok: false, message: "Something went wrong saving that. Please try again." };
  }
}

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";
const id = z.string().uuid();

export async function createProductAction(input: unknown): Promise<ActionResult<string>> {
  const parsed = newProductInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return run((b, u) => withTransaction((c) => createProduct(c, b, u, parsed.data)));
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
  return run((b, u) =>
    withTransaction(async (c) => {
      await updateProduct(c, b, u, d.productId, d.fields);
      for (const { id: variantId, ...v } of d.variants) await updateVariant(c, b, variantId, v);
      for (const v of d.newVariants) await addVariant(c, b, d.productId, v);
    })
  );
}

export async function setPriorityAction(productId: string, on: boolean): Promise<ActionResult> {
  if (!id.safeParse(productId).success) return { ok: false, message: "Unknown product" };
  return run((b) => withTransaction((c) => setPriority(c, b, productId, !!on)));
}

export async function setActiveAction(productId: string, on: boolean): Promise<ActionResult> {
  if (!id.safeParse(productId).success) return { ok: false, message: "Unknown product" };
  return run((b) => withTransaction((c) => setProductActive(c, b, productId, !!on)));
}

export async function setMinLevelAction(variantId: string, minLevel: number): Promise<ActionResult> {
  const parsed = z.object({ variantId: id, minLevel: variantInput.shape.minLevel }).safeParse({ variantId, minLevel });
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return run((b) => withTransaction((c) => setMinLevel(c, b, parsed.data.variantId, parsed.data.minLevel)));
}
