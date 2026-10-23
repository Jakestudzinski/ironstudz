import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { runDailyEmails } from "@/lib/inventory/daily-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET /api/inventory/cron/daily-email — run by Vercel Cron every 15 minutes (see vercel.json).
 * Vercel sends "Authorization: Bearer $CRON_SECRET". Sends any daily emails that are due.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const base = process.env.INVENTORY_BASE_URL || process.env.NEXTAUTH_URL || new URL(req.url).origin;
  const result = await runDailyEmails(base);
  return NextResponse.json({ ok: true, ...result });
}
