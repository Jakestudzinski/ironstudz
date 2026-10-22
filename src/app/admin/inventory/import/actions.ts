"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/inventory/context";
import { withRollback, withTransaction } from "@/lib/inventory/db";
import { InboundError } from "@/lib/inventory/errors";
import { runImport, type ImportResult } from "@/lib/inventory/import";

export type ImportResponse = { ok: true; result: ImportResult } | { ok: false; message: string; result?: ImportResult };

// About 1 MB of text: far more than 2,000 product rows.
const csvText = z.string().max(1_000_000, "That file is too big. Split it into smaller files.");

/** Checks the file and shows what would happen. Runs the real import in a transaction and rolls it back. */
export async function previewImportAction(csv: string): Promise<ImportResponse> {
  const { user, business } = await requireManager();
  const parsed = csvText.safeParse(csv);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  try {
    return { ok: true, result: await withRollback((c) => runImport(c, business.id, user.id, parsed.data, false)) };
  } catch (err) {
    console.error("import preview failed", err);
    return { ok: false, message: "Couldn't read that file. Check it's a CSV saved from the template." };
  }
}

/** Imports the file in one transaction: everything or nothing. */
export async function applyImportAction(csv: string): Promise<ImportResponse> {
  const { user, business } = await requireManager();
  const parsed = csvText.safeParse(csv);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  try {
    const result = await withTransaction((c) => runImport(c, business.id, user.id, parsed.data, true));
    revalidatePath("/admin/inventory", "layout");
    return { ok: true, result };
  } catch (err) {
    if (err instanceof InboundError) {
      return { ok: false, message: err.message, result: err.details as ImportResult | undefined };
    }
    console.error("import failed", err);
    return { ok: false, message: "The import failed and nothing was changed. Please try again." };
  }
}
