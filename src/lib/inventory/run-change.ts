import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { requireManager } from "./context";
import { withTransaction } from "./db";
import { InboundError } from "./errors";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

/**
 * For server actions: runs a change in one transaction for the manager's active business, refreshes the
 * inventory pages, and turns expected errors into a message for the screen.
 */
export async function runChange<T>(
  fn: (c: PoolClient, businessId: string, userId: string) => Promise<T>
): Promise<ActionResult<T>> {
  const { user, business } = await requireManager();
  try {
    const data = await withTransaction((c) => fn(c, business.id, user.id));
    revalidatePath("/admin/inventory", "layout");
    return { ok: true, data };
  } catch (err) {
    if (err instanceof InboundError) return { ok: false, message: err.message };
    console.error("inventory change failed", err);
    return { ok: false, message: "Something went wrong saving that. Nothing was changed. Please try again." };
  }
}
