"use server";

import { z } from "zod";
import { requireManager } from "@/lib/inventory/context";
import { runChange, type ActionResult } from "@/lib/inventory/run-change";
import { settingsInput, updateSettings } from "@/lib/inventory/settings";
import { buildDailyEmail, sendEmail } from "@/lib/inventory/daily-email";

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";

export async function saveSettingsAction(input: unknown): Promise<ActionResult> {
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return runChange((c, b) => updateSettings(c, b, parsed.data));
}

/** Sends today's email for the active business to the person asking (not the whole list), so it's safe to try. */
export async function sendTestEmailAction(): Promise<ActionResult<{ status: "sent" | "preview"; to: string }>> {
  const { user, business } = await requireManager();
  if (!user.email) return { ok: false, message: "Your account has no email address to send the test to" };
  try {
    const base = process.env.INVENTORY_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
    const email = await buildDailyEmail(business.id, base);
    const status = await sendEmail([user.email], { ...email, subject: `[Test] ${email.subject}` });
    return { ok: true, data: { status, to: user.email } };
  } catch (err) {
    console.error("test email failed", err);
    return { ok: false, message: `The email couldn’t be sent: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
