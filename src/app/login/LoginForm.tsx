"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import toast from "react-hot-toast";
import { LogIn } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (!result || result.error) {
        toast.error("Invalid email or password");
        return;
      }
      toast.success("Signed in");
      router.push(search.get("callbackUrl") ?? "/account");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const hasGoogle = Boolean(process.env.NEXT_PUBLIC_GOOGLE_ENABLED);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 outline-none focus:border-foreground dark:border-white/10"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 outline-none focus:border-foreground dark:border-white/10"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-1 rounded-md bg-foreground px-3 py-2 text-sm text-background hover:opacity-90 disabled:opacity-50"
      >
        <LogIn size={16} />
        {pending ? "Signing in..." : "Sign in"}
      </button>
      {hasGoogle ? (
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/account" })}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-black/10 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          Continue with Google
        </button>
      ) : null}
    </form>
  );
}
