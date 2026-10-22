import ui from "../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listLocations } from "@/lib/inventory/products";
import { listLotOptions, listStock, listVariantOptions } from "@/lib/inventory/stock-reads";
import { AdjustForm } from "./AdjustForm";

export const metadata = { title: "Adjust stock · Inventory" };

export default async function AdjustPage() {
  const { business } = await requireManager();
  const [stock, variants, lots, locations] = await Promise.all([
    listStock(business.id), listVariantOptions(business.id), listLotOptions(business.id), listLocations(),
  ]);
  return (
    <>
      <div>
        <h1 className={ui.heading}>Adjust stock</h1>
        <p className={ui.sub}>
          Correct the count with a reason: damaged, found, a count correction, or a cancelled order put back on the shelf.
          Every adjustment is kept in the history.
        </p>
      </div>
      <AdjustForm stock={stock} variants={variants} lots={lots} locations={locations} />
    </>
  );
}
