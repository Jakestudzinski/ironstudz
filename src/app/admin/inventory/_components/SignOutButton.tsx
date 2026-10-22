"use client";

import { useAuth } from "@/context/AuthContext";
import styles from "../layout.module.css";

export function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <button type="button" className={styles.signOut} onClick={() => signOut({ callbackUrl: "/login" })}>
      Sign out
    </button>
  );
}
