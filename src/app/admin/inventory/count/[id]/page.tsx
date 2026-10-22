import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "../../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { getCount } from "@/lib/inventory/counts";
import { listLotOptions, listVariantOptions } from "@/lib/inventory/stock-reads";
import { formatPhoenix } from "@/lib/inventory/product-meta";
import { CountSheet } from "./CountSheet";

export const metadata = { title: "Stock count · Inventory" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireManager();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const count = await getCount(business.id, id);
  if (!count) notFound();
  const open = count.status === "open";
  const [variants, lots] = open ? await Promise.all([listVariantOptions(business.id), listLotOptions(business.id)]) : [[], []];

  return (
    <>
      <Link href="/admin/inventory/count" className={ui.back}>← All counts</Link>
      <div>
        <h1 className={ui.heading}>Count: {count.location}</h1>
        <p className={ui.sub}>
          Started {formatPhoenix(count.startedAt)} by {count.startedBy}
          {count.status === "finished" && count.finishedAt && ` · finished ${formatPhoenix(count.finishedAt)}`}
          {count.status === "cancelled" && " · cancelled, no stock was changed"}
        </p>
      </div>
      <CountSheet count={count} variants={variants} lots={lots} />
    </>
  );
}
