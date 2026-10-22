import type { ReactNode } from "react";
import "./inventory.css";
import styles from "./layout.module.css";
import { getInventoryContext } from "@/lib/inventory/context";
import { BusinessSwitcher } from "./_components/BusinessSwitcher";
import { InventoryNav } from "./_components/InventoryNav";
import { SignOutButton } from "./_components/SignOutButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventory", robots: { index: false, follow: false } };
// Fit the device, and let the page use the full screen on notched phones (content is padded clear of it in CSS)
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const { user, businesses, active } = await getInventoryContext();

  if (!active) {
    return (
      <div className="inv-root">
        <main className={styles.noAccess}>
          <h1>No inventory access</h1>
          <p>Your account isn’t linked to any business yet. Ask an admin to add you as a manager.</p>
          <div className={styles.noAccessActions}><SignOutButton /></div>
        </main>
      </div>
    );
  }

  return (
    <div className="inv-root">
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <p className={styles.title}>Inventory</p>
            <BusinessSwitcher businesses={businesses} activeId={active.id} />
          </div>
          <div className={styles.account}>
            <span className={styles.user}>{user.name ?? user.email ?? "Manager"}</span>
            <SignOutButton />
          </div>
        </div>
        <InventoryNav />
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
