"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import toast from "react-hot-toast";
import { UserPlus } from "lucide-react";

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error(body?.error ?? "Could not create account");
        return;
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (signInResult?.error) {
        toast.error("Account created, but sign-in failed");
        router.push("/login");
        return;
      }

      toast.success("Welcome!");
      router.push("/account");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span>Name</span>
        <input
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 outline-none focus:border-foreground dark:border-white/10"
        />
      </label>
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
          autoComplete="new-password"
          minLength={8}
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
        <UserPlus size={16} />
        {pending ? "Creating..." : "Create account"}
      </button>
    </form>
  );
}
