import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "../../../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { getProductDetail, listLocations } from "@/lib/inventory/products";
import { productLabel } from "@/lib/inventory/product-meta";
import { ProductForm } from "../../ProductForm";

export const metadata = { title: "Edit product · Inventory" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireManager();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [d, locations] = await Promise.all([getProductDetail(business.id, id), listLocations()]);
  if (!d) notFound();

  return (
    <>
      <Link href={`/admin/inventory/products/${id}`} className={ui.back}>← {productLabel(d.product)}</Link>
      <div>
        <h1 className={ui.heading}>Edit product</h1>
        <p className={ui.sub}>
          Changing a SKU here means the website must send the new SKU from now on, or its orders will be flagged.
        </p>
      </div>
      <ProductForm
        locations={locations}
        priorityCount={0}
        product={{ ...d.product, variants: d.variants }}
      />
    </>
  );
}
