import { getSessionUser } from "@/lib/inventory/session";
import { listManagedBusinesses, resolveActiveBusiness } from "@/lib/inventory/businesses";
import { allMovements, movementsCsv } from "@/lib/inventory/movements";
import { readMovementFilters } from "@/lib/inventory/movement-filters";

export const runtime = "nodejs";

/** GET /api/inventory/movements?from=&to=&type=&product=&who=&order= — the filtered movement log as a CSV file. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Please sign in", { status: 401 });
  // The business is the manager's active one, checked on the server; never taken from the request.
  const business = await resolveActiveBusiness(user.id, await listManagedBusinesses(user.id));
  if (!business) return new Response("No inventory access", { status: 403 });

  const { filters } = readMovementFilters(new URL(req.url).searchParams);
  const csv = movementsCsv(await allMovements(business.id, filters));
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());
  const name = `${business.name.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "")}-movements-${day}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
