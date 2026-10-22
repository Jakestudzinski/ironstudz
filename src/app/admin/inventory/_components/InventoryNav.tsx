"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import styles from "../layout.module.css";

// Later phases add their screens here. `also` lists other pages that belong under the same tab.
const LINKS = [
  { href: "/admin/inventory", label: "Dashboard", also: [] },
  { href: "/admin/inventory/products", label: "Products", also: ["/admin/inventory/import"] },
  { href: "/admin/inventory/receive", label: "Receive", also: [] },
  { href: "/admin/inventory/lots", label: "Lots", also: [] },
  { href: "/admin/inventory/break-down", label: "Break down", also: [] },
  { href: "/admin/inventory/transfer", label: "Move", also: [] },
  { href: "/admin/inventory/adjust", label: "Adjust", also: [] },
  { href: "/admin/inventory/vial-weights", label: "Vial weights", also: [] },
];

export function InventoryNav() {
  const path = usePathname();
  const nav = useRef<HTMLElement>(null);
  // On phones the tabs scroll sideways; keep the current one in view.
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [path]);
  return (
    <nav aria-label="Inventory" className={styles.nav} ref={nav}>
      {LINKS.map((l) => {
        const current =
          l.href === "/admin/inventory" ? path === l.href : [l.href, ...l.also].some((h) => path.startsWith(h));
        return (
          <Link key={l.href} href={l.href} aria-current={current ? "page" : undefined} className={styles.navLink}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
