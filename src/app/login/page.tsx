import { Suspense } from "react";

import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · ironstudz" };

export default function LoginPage() {
  return (
    <section className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <Suspense fallback={<div className="text-sm opacity-60">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </section>
  );
}
