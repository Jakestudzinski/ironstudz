import ui from "../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listLocations } from "@/lib/inventory/products";
import { listVariantOptions } from "@/lib/inventory/stock-reads";
import { ReceiveForm } from "./ReceiveForm";

export const metadata = { title: "Receive stock · Inventory" };

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ variant?: string | string[] }> }) {
  const { business } = await requireManager();
  const { variant } = await searchParams;
  const [variants, locations] = await Promise.all([listVariantOptions(business.id), listLocations()]);
  return (
    <>
      <div>
        <h1 className={ui.heading}>Receive stock</h1>
        <p className={ui.sub}>New lots start as In testing and can’t be sold until they pass.</p>
      </div>
      {variants.length === 0 ? (
        <section className={ui.panel}><p className={ui.empty}>Add products to {business.name} first.</p></section>
      ) : (
        <ReceiveForm variants={variants} locations={locations} initialVariantId={typeof variant === "string" ? variant : undefined} />
      )}
    </>
  );
}
