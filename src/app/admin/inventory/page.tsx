import Link from "next/link";
import ui from "./_components/ui.module.css";
import styles from "./page.module.css";
import { requireManager } from "@/lib/inventory/context";
import { getAlerts, listCancelledToReview, listOpenIssues } from "@/lib/inventory/alerts";
import { listProducts } from "@/lib/inventory/products";
import { listLots } from "@/lib/inventory/stock-reads";
import { recentActivity } from "@/lib/inventory/activity";
import { STATUS_LABEL, formatMix, formatPhoenix, productLabel } from "@/lib/inventory/product-meta";
import { AlertCards } from "./_components/AlertCards";
import { CancelledOrders, OrderIssues } from "./_components/OrderReviews";

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric" }).format(new Date(iso));

export default async function InventoryDashboard() {
  const { business } = await requireManager();
  const [alerts, cancelled, issues, priority, lots, activity] = await Promise.all([
    getAlerts(business.id),
    listCancelledToReview(business.id),
    listOpenIssues(business.id),
    listProducts(business.id, { priorityOnly: true, sort: "days" }),
    listLots(business.id),
    recentActivity(business.id, 10),
  ]);
  const testing = lots.inTesting;
  const oldest = testing[0]?.daysWaiting;

  return (
    <>
      <h1 className={ui.visuallyHidden}>{business.name} inventory dashboard</h1>

      <AlertCards alerts={alerts} />

      <CancelledOrders
        orders={cancelled.map((o) => ({
          id: o.id,
          title: `Order ${o.orderRef}${o.items.length ? ` · ${o.items.join(", ")}` : ""}`,
          when: `Paid ${shortDate(o.paidAt)} · ${o.type} ${shortDate(o.cancelledAt)}`,
        }))}
      />

      {issues.length > 0 && (
        <OrderIssues
          issues={issues.map((i) => ({
            id: i.id,
            title: `Order ${i.orderRef} · ${i.product ?? `SKU ${i.sku}`}`,
            info:
              i.issue === "unknown_sku"
                ? `Unknown SKU “${i.sku}” · ${i.requested} ordered, nothing taken from stock`
                : `Not enough stock · ${i.requested} ordered, ${i.deducted} taken from stock`,
          }))}
        />
      )}

      <section aria-labelledby="dash-actions" className={styles.actionsSection}>
        <h2 id="dash-actions" className={styles.sectionTitle}>Quick actions</h2>
        <div className={styles.quick}>
          <Link href="/admin/inventory/break-down" className={styles.quickLink}>Break down kit</Link>
          <Link href="/admin/inventory/receive" className={styles.quickLink}>Receive stock</Link>
          <Link href="/admin/inventory/lots" className={styles.quickLink}>Update testing</Link>
        </div>
      </section>

      <div className={styles.columns}>
        <section className={ui.panel} aria-labelledby="dash-priority">
          <div className={ui.panelHead}>
            <h2 id="dash-priority" className={ui.panelTitle}>Priority products at a glance</h2>
            <p className={ui.hint}>Sellable stock · days of cover from the last 60 days of sales · most urgent first</p>
          </div>
          {priority.products.length === 0 ? (
            <p className={ui.empty}>
              No priority products yet. Tick “Priority product” on up to 15 products to watch their days of cover here.
            </p>
          ) : (
            <>
              <table className={`${ui.table} inv-hide-phone`}>
                <thead>
                  <tr>
                    <th>Product</th><th>On hand</th><th className={ui.num}>Total</th>
                    <th className={ui.num}>Per day</th><th className={ui.num}>Days</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {priority.products.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/admin/inventory/products/${p.id}`} className={styles.productLink}>{productLabel(p)}</Link></td>
                      <td>{formatMix(p.sellable, p.forms)}</td>
                      <td className={ui.num}>{p.total}</td>
                      <td className={ui.num}>{p.salesPerDay.toFixed(1)}</td>
                      <td className={ui.num}>{p.daysOfCover ?? "—"}</td>
                      <td><span className={`${ui.pill} ${ui[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className={`${styles.priorityCards} inv-show-phone`}>
                {priority.products.map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/inventory/products/${p.id}`} className={styles.priorityCard}>
                      <span className={styles.priorityTop}>
                        <b>{productLabel(p)}</b>
                        <span className={`${ui.pill} ${ui[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                      </span>
                      <span>{formatMix(p.sellable, p.forms)}</span>
                      <span className={styles.muted}>
                        {p.total} total · {p.salesPerDay.toFixed(1)}/day · {p.daysOfCover ?? "—"} days
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className={styles.side}>
          <section className={ui.panel} aria-labelledby="dash-lots">
            <div>
              <h2 id="dash-lots" className={ui.panelTitle}>Lots in testing</h2>
              <p className={ui.hint}>
                {testing.length === 0 ? "Nothing waiting" : `${testing.length} waiting · oldest ${oldest} ${oldest === 1 ? "day" : "days"}`}
              </p>
            </div>
            {testing.length > 0 && (
              <ul className={ui.lines}>
                {testing.slice(0, 5).map((l) => (
                  <li key={l.id} className={styles.lotRow}>
                    <span>
                      <b>{l.product}</b>
                      <span className={styles.muted}>Lot {l.lotNumber} · {l.daysWaiting} days</span>
                    </span>
                    <span className={`${ui.pill} ${l.overdue ? ui.reorder : ui.in_testing}`}>{l.overdue ? "Overdue" : "In testing"}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/admin/inventory/lots" className={styles.more}>
              {testing.length > 5 ? `All ${testing.length} lots in testing` : "Lots and testing"} →
            </Link>
          </section>

          <section className={ui.panel} aria-labelledby="dash-activity">
            <h2 id="dash-activity" className={ui.panelTitle}>Recent activity</h2>
            {activity.length === 0 ? (
              <p className={ui.empty}>No stock changes yet.</p>
            ) : (
              <ul className={ui.lines}>
                {activity.map((a) => (
                  <li key={a.id}>
                    <b>{a.who}</b> · {a.text}
                    <div className={styles.muted}>{formatPhoenix(a.at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
