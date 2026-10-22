import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";
import { listManagedBusinesses, resolveActiveBusiness, type BusinessSummary } from "./businesses";

export type InventoryContext = {
  user: SessionUser;
  businesses: BusinessSummary[];
  active: BusinessSummary | null;
};

const SIGN_IN = "/login?callbackUrl=" + encodeURIComponent("/admin/inventory");

/** Signed-in user, the businesses they manage, and the active one. Redirects to sign in if needed. */
export const getInventoryContext = cache(async (): Promise<InventoryContext> => {
  const user = await getSessionUser();
  if (!user) redirect(SIGN_IN);
  const businesses = await listManagedBusinesses(user.id);
  const active = await resolveActiveBusiness(user.id, businesses);
  return { user, businesses, active };
});

/**
 * Use at the top of every inventory page, server action and read.
 * Returns the user and the business they are acting in, verified on the server.
 */
export async function requireManager(): Promise<{ user: SessionUser; business: BusinessSummary }> {
  const ctx = await getInventoryContext();
  if (!ctx.active) redirect("/admin/inventory");
  return { user: ctx.user, business: ctx.active };
}
