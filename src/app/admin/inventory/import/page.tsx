import Link from "next/link";
import ui from "../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { IMPORT_TEMPLATE } from "@/lib/inventory/import";
import { ImportScreen } from "./ImportScreen";

export const metadata = { title: "Bulk import · Inventory" };

export default async function ImportPage() {
  const { business } = await requireManager();
  return (
    <>
      <Link href="/admin/inventory/products" className={ui.back}>← All products</Link>
      <div>
        <h1 className={ui.heading}>Bulk import</h1>
        <p className={ui.sub}>Add or update many products for {business.name} at once from a spreadsheet saved as CSV.</p>
      </div>
      <ImportScreen template={IMPORT_TEMPLATE} />
    </>
  );
}
