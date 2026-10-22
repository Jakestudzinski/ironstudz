import ui from "../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listLocations } from "@/lib/inventory/products";
import { listStock } from "@/lib/inventory/stock-reads";
import { BreakDownForm } from "./BreakDownForm";

export const metadata = { title: "Break down kit · Inventory" };

export default async function BreakDownPage() {
  const { business } = await requireManager();
  const [stock, locations] = await Promise.all([listStock(business.id, ["kit", "half_kit"]), listLocations()]);
  const openable = stock.filter((s) => s.testingStatus !== "failed");
  return (
    <>
      <div>
        <h1 className={ui.heading}>Break down kit</h1>
        <p className={ui.sub}>Open sealed kits to refill loose vials at the packing station. The vials keep the kit’s lot.</p>
      </div>
      {openable.length === 0 ? (
        <section className={ui.panel}><p className={ui.empty}>There are no sealed kits or half kits to break down.</p></section>
      ) : (
        <BreakDownForm stock={openable} racks={locations.filter((l) => l.area === "packing_station")} />
      )}
    </>
  );
}
