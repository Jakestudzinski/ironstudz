"use client";

import Link from "next/link";
import { LogIn, LogOut, UserPlus, User as UserIcon } from "lucide-react";

import { useAuth } from "@/context/AuthContext";

export function Navbar() {
  const { user, status, signOut } = useAuth();

  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          ironstudz
        </Link>

        <div className="flex items-center gap-3 text-sm">
          {status === "loading" ? (
            <span className="opacity-60">Loading...</span>
          ) : user ? (
            <>
              <Link
                href="/account"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
              >
                <UserIcon size={16} />
                {user.name ?? user.email ?? "Account"}
              </Link>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
              >
                <LogIn size={16} />
                Sign in
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1 text-background hover:opacity-90"
              >
                <UserPlus size={16} />
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
