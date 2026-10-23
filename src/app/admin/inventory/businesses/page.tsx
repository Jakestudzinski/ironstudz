import ui from "../_components/ui.module.css";
import { getInventoryContext } from "@/lib/inventory/context";
import { requireOwner } from "@/lib/inventory/owner";
import { listAllBusinesses } from "@/lib/inventory/admin";
import { BusinessesBoard } from "./BusinessesBoard";

export const metadata = { title: "Businesses · Inventory" };

export default async function BusinessesPage() {
  const owner = await requireOwner();
  const [{ active, businesses: managed }, all] = await Promise.all([getInventoryContext(), listAllBusinesses()]);
  const live = all.filter((b) => b.isActive).length;

  return (
    <>
      <div>
        <h1 className={ui.heading}>Businesses</h1>
        <p className={ui.sub}>
          {live} {live === 1 ? "business" : "businesses"} · each has its own products, stock, alerts and daily email.
          Only site admins see this page.
        </p>
      </div>
      <BusinessesBoard
        businesses={all}
        activeId={active?.id ?? null}
        managedIds={managed.map((b) => b.id)}
        ownerId={owner.id}
      />
    </>
  );
}
