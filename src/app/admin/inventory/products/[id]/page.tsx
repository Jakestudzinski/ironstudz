import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "../../_components/ui.module.css";
import styles from "./detail.module.css";
import { requireManager } from "@/lib/inventory/context";
import { getProductDetail, type HistoryRow } from "@/lib/inventory/products";
import {
  CATEGORY_LABEL, FORM_LABEL, STATUS_LABEL, formatMix, formatPhoenix, productLabel, type PackageType,
} from "@/lib/inventory/product-meta";
import { ProductSwitches } from "./ProductSwitches";
import { MinLevelInput } from "./MinLevelInput";

const FORM_NAME: Record<PackageType, string> = { kit: "Kit", half_kit: "Half kit", vial: "Vial", unit: "Unit" };
const TESTING_LABEL = { passed: "Passed", in_testing: "In testing", failed: "Failed" } as const;
const REASON_LABEL: Record<string, string> = {
  count_correction: "count correction", damaged: "damaged", failed_testing: "failed testing",
  order_cancelled: "order cancelled", other: "other",
};

function describe(h: HistoryRow, product: string): string {
  const name = FORM_NAME[h.packageType].toLowerCase();
  const form = h.type === "sold" || h.quantity === 1 ? name : `${name}s`;
  const lot = `lot ${h.lotNumber}`;
  switch (h.type) {
    case "sold": return `Sold ${product} ${form} × ${h.quantity}${h.orderRef ? ` · Order ${h.orderRef}` : ""}`;
    case "received": return `Received ${h.quantity} ${form} · ${lot}${h.to ? ` → ${h.to}` : ""}`;
    case "break_down": return h.from
      ? `Broke down ${h.quantity} ${form} · ${lot} from ${h.from}`
      : `Added ${h.quantity} ${form} from break down · ${lot}${h.to ? ` → ${h.to}` : ""}`;
    case "transfer": return `Moved ${h.quantity} ${form} · ${lot} · ${h.from} → ${h.to}`;
    case "adjustment": return `${h.to ? "Added" : "Removed"} ${h.quantity} ${form} · ${lot} · ${REASON_LABEL[h.reason ?? ""] ?? "adjustment"}${h.notes ? ` · ${h.notes}` : ""}`;
  }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireManager();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getProductDetail(business.id, id);
  if (!d) notFound();

  const p = d.product;
  const label = productLabel(p);
  const forms = d.variants.filter((v) => v.isActive).map((v) => v.packageType);
  const unitWord = p.category === "peptide" ? "vials" : "units";

  return (
    <>
      <Link href="/admin/inventory/products" className={ui.back}>← All products</Link>

      <div className={ui.pageHead}>
        <div className={styles.title}>
          <h1 className={ui.heading}>{label}</h1>
          <p className={ui.sub}>
            {CATEGORY_LABEL[p.category]} · {formatMix(d.sellableMix, forms)}
            {p.category === "peptide" && ` · Vial weight ${p.vialWeightG !== null ? `${p.vialWeightG} g` : "not set"}`}
          </p>
          <Link href={`/admin/inventory/products/${p.id}/edit`} className={`${ui.secondary} ${styles.edit}`}>
            Edit product
          </Link>
        </div>
        <ProductSwitches productId={p.id} isPriority={p.isPriority} isActive={p.isActive} />
      </div>

      <section className={styles.stats} aria-label="Summary">
        <div className={ui.card}>
          <span className={styles.value}>{d.sellable}</span>
          <span className={styles.statLabel}>Sellable {unitWord}{p.category === "peptide" && " (equivalent)"}</span>
        </div>
        <div className={ui.card}>
          <span className={`${styles.value} ${styles.blue}`}>{d.inTesting}</span>
          <span className={styles.statLabel}>In testing</span>
        </div>
        <div className={ui.card}>
          <span className={styles.value}>{d.salesPerDay}</span>
          <span className={styles.statLabel}>Sales per day ({d.salesWindowDays} days)</span>
        </div>
        <div className={ui.card}>
          <span className={`${styles.value} ${styles[d.status]}`}>{d.daysOfCover ?? "—"}</span>
          <span className={styles.statLabel}>
            Days of cover <span className={`${ui.pill} ${ui[d.status]}`}>{STATUS_LABEL[d.status]}</span>
          </span>
        </div>
      </section>

      <section className={ui.panel} aria-labelledby="pd-stock">
        <h2 id="pd-stock" className={ui.panelTitle}>Stock by form, lot and location</h2>
        {d.stock.length === 0 ? (
          <p className={ui.empty}>No stock yet. Stock appears here once a delivery is received.</p>
        ) : (
          <>
            <table className={`${ui.table} inv-hide-phone`}>
              <thead>
                <tr><th>Form</th><th>Lot</th><th>Location</th><th className={ui.num}>Qty</th><th>Testing</th></tr>
              </thead>
              <tbody>
                {d.stock.map((s, i) => (
                  <tr key={i}>
                    <td><b>{FORM_NAME[s.packageType]}</b></td>
                    <td className={ui.mono}>{s.lotNumber}</td>
                    <td>{s.location}</td>
                    <td className={ui.num}>{s.quantity}</td>
                    <td><span className={`${ui.pill} ${ui[s.testingStatus]}`}>{TESTING_LABEL[s.testingStatus]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className={`${ui.lines} inv-show-phone`}>
              {d.stock.map((s, i) => (
                <li key={i} className={styles.stockLine}>
                  <div>
                    <b>{FORM_NAME[s.packageType]} · {s.location}</b>
                    <div className={styles.muted}>Lot {s.lotNumber}</div>
                  </div>
                  <span className={styles.qty}>{s.quantity}</span>
                  <span className={`${ui.pill} ${ui[s.testingStatus]}`}>{TESTING_LABEL[s.testingStatus]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={ui.panel} aria-labelledby="pd-forms">
        <div className={ui.panelHead}>
          <h2 id="pd-forms" className={ui.panelTitle}>Forms and SKUs</h2>
          <p className={ui.hint}>Min level sets the low-stock and refill alerts</p>
        </div>
        {d.variants.length === 0 ? (
          <p className={ui.empty}>No forms yet. Use Edit product to add one with its website SKU.</p>
        ) : (
          <ul className={ui.lines}>
            <li className={`${styles.formRow} ${styles.formHeadings} inv-hide-tablet`} aria-hidden="true">
              <span>Form</span><span>Website SKU</span><span>Home location</span>
              <span className={styles.onHand}>On hand</span><span>Min level</span>
            </li>
            {d.variants.map((v) => (
              <li key={v.id} className={`${styles.formRow} ${v.isActive ? "" : styles.inactive}`}>
                <div className={styles.formName}>
                  <b>{FORM_LABEL[v.packageType]}</b>
                  {!v.isActive && <span className={`${ui.pill} ${ui.neutral}`}>Off</span>}
                </div>
                <span className={`${ui.mono} ${styles.sku}`}>{v.sku}</span>
                <span className={styles.home}>{v.homeLocation ?? "No home location"}</span>
                <span className={styles.onHand}><span className={ui.mono}>{v.onHand}</span> on hand</span>
                <MinLevelInput variantId={v.id} initial={v.minLevel} label={`Min level for ${FORM_LABEL[v.packageType]}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={ui.panel} aria-labelledby="pd-history">
        <h2 id="pd-history" className={ui.panelTitle}>History</h2>
        {d.history.length === 0 ? (
          <p className={ui.empty}>No stock changes yet.</p>
        ) : (
          <ul className={ui.lines}>
            {d.history.map((h) => (
              <li key={h.id}>
                <b>{h.who ?? "Website"}</b> · {describe(h, label)}
                <div className={styles.muted}>{formatPhoenix(h.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
        <p className={ui.hint}>Showing the 20 most recent changes. Full history comes with Movement history (Phase 6).</p>
      </section>
    </>
  );
}
