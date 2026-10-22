import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export type SessionUser = { id: string; name?: string | null; email?: string | null };

/**
 * The signed-in website user, from the site's NextAuth v4 setup in `@/lib/auth`.
 * `session.user.id` is filled in by the `session` callback there (JWT strategy).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return null;
  return { id, name: session.user?.name ?? null, email: session.user?.email ?? null };
}
