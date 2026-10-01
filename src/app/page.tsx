import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function HomePage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-20">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        ironstudz starter
      </h1>
      <p className="text-base opacity-80 sm:text-lg">
        Next.js 16 (App Router) + React 19 + TypeScript, Tailwind 4, Prisma with
        PostgreSQL, NextAuth (credentials + Google), Zod, and Vitest. Ready to
        deploy on Vercel.
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/register"
          className="inline-flex items-center gap-1 rounded-md bg-foreground px-4 py-2 text-background hover:opacity-90"
        >
          Create an account
          <ArrowRight size={16} />
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center gap-1 rounded-md border border-black/10 px-4 py-2 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}
