import Link from "next/link";
import ui from "../../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listLocations, listProducts } from "@/lib/inventory/products";
import { ProductForm } from "../ProductForm";

export const metadata = { title: "Add product · Inventory" };

export default async function NewProductPage() {
  const { business } = await requireManager();
  const [locations, { priority }] = await Promise.all([listLocations(), listProducts(business.id, { priorityOnly: true })]);

  return (
    <>
      <Link href="/admin/inventory/products" className={ui.back}>← All products</Link>
      <div>
        <h1 className={ui.heading}>Add product</h1>
        <p className={ui.sub}>One product at one strength or size, with a website SKU for each form it’s sold in.</p>
      </div>
      <ProductForm locations={locations} priorityCount={priority} />
    </>
  );
}
