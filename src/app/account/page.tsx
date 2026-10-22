import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/lib/auth";

export const metadata = { title: "Account · StudzStock" };

export default async function AccountPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login?callbackUrl=/account");
  }

  return (
    <section className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="opacity-60">Name</dt>
        <dd>{session.user.name ?? "—"}</dd>
        <dt className="opacity-60">Email</dt>
        <dd>{session.user.email ?? "—"}</dd>
        <dt className="opacity-60">Role</dt>
        <dd>{session.user.role}</dd>
      </dl>
    </section>
  );
}
