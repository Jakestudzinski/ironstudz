"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

type Role = "USER" | "ADMIN";

type AuthUser = {
  id: string;
  email: string | null | undefined;
  name: string | null | undefined;
  image: string | null | undefined;
  role: Role;
};

type AuthContextValue = {
  user: AuthUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  isAdmin: boolean;
  signIn: typeof signIn;
  signOut: typeof signOut;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, status } = useSession();

  const value = useMemo<AuthContextValue>(() => {
    const user: AuthUser | null = data?.user
      ? {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          image: data.user.image,
          role: data.user.role,
        }
      : null;

    return {
      user,
      status,
      isAdmin: user?.role === "ADMIN",
      signIn,
      signOut,
    };
  }, [data, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
