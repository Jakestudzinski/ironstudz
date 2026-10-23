import { getSessionUser } from "@/lib/inventory/session";
import { listManagedBusinesses, resolveActiveBusiness } from "@/lib/inventory/businesses";
import { buildDailyEmail } from "@/lib/inventory/daily-email";

export const runtime = "nodejs";

/** GET /api/inventory/email-preview — today's daily email for the manager's active business, as a web page. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Please sign in", { status: 401 });
  const business = await resolveActiveBusiness(user.id, await listManagedBusinesses(user.id));
  if (!business) return new Response("No inventory access", { status: 403 });
  const base = process.env.INVENTORY_BASE_URL || process.env.NEXTAUTH_URL || new URL(req.url).origin;
  const email = await buildDailyEmail(business.id, base);
  return new Response(email.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
