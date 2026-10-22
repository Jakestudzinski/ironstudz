import Link from "next/link";
import ui from "../_components/ui.module.css";
import styles from "./movements.module.css";
import { requireManager } from "@/lib/inventory/context";
import { PAGE_SIZE, TYPE_LABEL, listMovementUsers, listMovements, type MovementRow } from "@/lib/inventory/movements";
import { movementQuery, readMovementFilters } from "@/lib/inventory/movement-filters";
import { listProducts } from "@/lib/inventory/products";
import { formatPhoenix, productLabel } from "@/lib/inventory/product-meta";
import { REASON_LABEL, type AdjustReason } from "@/lib/inventory/operation-labels";
import { MovementFiltersForm } from "./MovementFiltersForm";

export const metadata = { title: "Movement history · Inventory" };

const FORM = { kit: "kit", half_kit: "half kit", vial: "vial", unit: "unit" } as const;
const where = (m: MovementRow) => (m.from && m.to ? `${m.from} → ${m.to}` : m.from ? `from ${m.from}` : m.to ? `to ${m.to}` : "");
const detail = (m: MovementRow) =>
  [m.reason ? REASON_LABEL[m.reason as AdjustReason] ?? m.reason : null, m.orderRef ? `Order ${m.orderRef}` : null, m.notes]
    .filter(Boolean).join(" · ");

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { business } = await requireManager();
  const { filters, page } = readMovementFilters(await searchParams);
  const [{ rows, total }, users, { products }] = await Promise.all([
    listMovements(business.id, filters, page),
    listMovementUsers(business.id),
    listProducts(business.id, { includeInactive: true }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const query = movementQuery(filters);
  const pageHref = (n: number) => {
    const q = new URLSearchParams(query);
    if (n > 1) q.set("page", String(n));
    return `/admin/inventory/movements${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.heading}>Movement history</h1>
          <p className={ui.sub}>Every stock change, who made it and why. Entries can’t be edited or deleted.</p>
        </div>
        <div className={ui.actions}>
          <a href={`/api/inventory/movements${query.size ? `?${query}` : ""}`} className={ui.secondary} download>
            Download CSV
          </a>
        </div>
      </div>

      <MovementFiltersForm
        initial={{
          from: filters.from ?? "", to: filters.to ?? "", type: filters.type ?? "", product: filters.productId ?? "",
          who: filters.who ?? "", order: filters.orderRef ?? "",
        }}
        products={products.map((p) => ({ id: p.id, label: productLabel(p) }))}
        users={users}
      />

      <section className={ui.panel} aria-label="Movements">
        <p className={ui.hint} role="status">
          {total === 0 ? "No movements match." : `${total.toLocaleString("en-US")} ${total === 1 ? "movement" : "movements"}` +
            (pages > 1 ? ` · page ${page} of ${pages}` : "")}
        </p>
        {rows.length > 0 && (
          <>
            <table className={`${ui.table} inv-hide-tablet`}>
              <thead>
                <tr>
                  <th>When</th><th>Type</th><th>Product</th><th>Lot</th><th>Where</th>
                  <th className={ui.num}>Qty</th><th>Why</th><th>Who</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className={styles.when}>{formatPhoenix(m.at)}</td>
                    <td>{TYPE_LABEL[m.type]}</td>
                    <td>
                      <Link href={`/admin/inventory/products/${m.productId}`} className={styles.product}>{m.product}</Link>
                      <span className={styles.muted}> · {FORM[m.packageType]}</span>
                    </td>
                    <td className={ui.mono}>{m.lotNumber}</td>
                    <td>{where(m)}</td>
                    <td className={`${ui.num} ${m.change > 0 ? styles.plus : m.change < 0 ? styles.minus : ""}`}>
                      {m.change > 0 ? `+${m.quantity}` : m.change < 0 ? `−${m.quantity}` : m.quantity}
                    </td>
                    <td className={styles.why}>{detail(m)}</td>
                    <td>{m.who}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className={`${ui.lines} inv-show-tablet`}>
              {rows.map((m) => (
                <li key={m.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <b>{TYPE_LABEL[m.type]} · {m.product} {FORM[m.packageType]}</b>
                    <span className={`${styles.qty} ${m.change > 0 ? styles.plus : m.change < 0 ? styles.minus : ""}`}>
                      {m.change > 0 ? `+${m.quantity}` : m.change < 0 ? `−${m.quantity}` : m.quantity}
                    </span>
                  </div>
                  <span className={styles.muted}>Lot {m.lotNumber}{where(m) ? ` · ${where(m)}` : ""}</span>
                  {detail(m) && <span>{detail(m)}</span>}
                  <span className={styles.muted}>{m.who} · {formatPhoenix(m.at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {pages > 1 && (
          <nav className={styles.pager} aria-label="Pages">
            {page > 1 ? <Link href={pageHref(page - 1)} className={ui.secondary}>← Newer</Link> : <span />}
            <span className={styles.muted}>Page {page} of {pages}</span>
            {page < pages ? <Link href={pageHref(page + 1)} className={ui.secondary}>Older →</Link> : <span />}
          </nav>
        )}
      </section>
    </>
  );
}
