import ui from "../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listLocations } from "@/lib/inventory/products";
import { listStock } from "@/lib/inventory/stock-reads";
import { TransferForm } from "./TransferForm";

export const metadata = { title: "Move stock · Inventory" };

export default async function TransferPage() {
  const { business } = await requireManager();
  const [stock, locations] = await Promise.all([listStock(business.id), listLocations()]);
  return (
    <>
      <div>
        <h1 className={ui.heading}>Move stock</h1>
        <p className={ui.sub}>Move a form and lot from one location to another. Nothing is added or removed.</p>
      </div>
      {stock.length === 0 ? (
        <section className={ui.panel}><p className={ui.empty}>There’s no stock to move yet.</p></section>
      ) : (
        <TransferForm stock={stock} locations={locations} />
      )}
    </>
  );
}
