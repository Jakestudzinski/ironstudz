import { redirect } from "next/navigation";
import { isOwner } from "./businesses";
import { getSessionUser, type SessionUser } from "./session";

export { isOwner } from "./businesses";

/** For owner-only pages: the signed-in owner, or a redirect. */
export async function requireOwner(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login?callbackUrl=" + encodeURIComponent("/admin/inventory/businesses"));
  if (!(await isOwner(user.id))) redirect("/admin/inventory");
  return user;
}
