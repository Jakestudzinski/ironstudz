"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/inventory/context";
import { setVialWeight } from "@/lib/inventory/weights";

export type SaveState = { ok: boolean; message: string } | null;

const SaveSchema = z.object({
  productId: z.string().uuid(),
  // Empty clears the weight. Grams, up to 3 decimals.
  weight: z
    .string()
    .trim()
    .refine((s) => s === "" || /^\d{1,5}(\.\d{1,3})?$/.test(s), "Enter grams, e.g. 5.2 (up to 3 decimals)")
    .refine((s) => s === "" || Number(s) > 0, "Weight must be more than 0"),
});

/** Saves one product's weight of one vial, for the manager's active business only. */
export async function saveVialWeight(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { user, business } = await requireManager();
  const parsed = SaveSchema.safeParse({ productId: formData.get("productId"), weight: formData.get("weight") ?? "" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the weight" };

  const weight = parsed.data.weight === "" ? null : Number(parsed.data.weight);
  const ok = await setVialWeight(business.id, user.id, parsed.data.productId, weight);
  if (!ok) return { ok: false, message: "That product isn't in this business" };

  revalidatePath("/admin/inventory/vial-weights");
  return { ok: true, message: weight === null ? "Cleared" : "Saved" };
}
