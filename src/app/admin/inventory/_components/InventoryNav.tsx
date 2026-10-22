"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../layout.module.css";

// Later phases add their screens here.
const LINKS = [
  { href: "/admin/inventory", label: "Dashboard" },
  { href: "/admin/inventory/vial-weights", label: "Vial weights" },
];

export function InventoryNav() {
  const path = usePathname();
  return (
    <nav aria-label="Inventory" className={styles.nav}>
      {LINKS.map((l) => {
        const current = l.href === "/admin/inventory" ? path === l.href : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={current ? "page" : undefined} className={styles.navLink}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
