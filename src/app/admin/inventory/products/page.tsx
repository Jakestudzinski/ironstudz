import Link from "next/link";
import ui from "../_components/ui.module.css";
import styles from "./products.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listLocations, listProducts, type ProductFilters } from "@/lib/inventory/products";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  MAX_PRIORITY,
  STATUS_LABEL,
  formatInTesting,
  formatMix,
  type Category,
} from "@/lib/inventory/product-meta";
import { ProductFiltersForm } from "./ProductFiltersForm";

export const metadata = { title: "Products · Inventory" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { business } = await requireManager();
  const sp = await searchParams;
  const locations = await listLocations();

  // Only accept known values from the address bar.
  const filters: ProductFilters = {
    search: one(sp.q).slice(0, 100),
    category: (CATEGORIES as readonly string[]).includes(one(sp.category)) ? (one(sp.category) as Category) : undefined,
    locationId: locations.some((l) => l.id === one(sp.location)) ? one(sp.location) : undefined,
    priorityOnly: one(sp.priority) === "1",
    includeInactive: one(sp.inactive) === "1",
    sort: one(sp.sort) === "days" || one(sp.sort) === "total" ? (one(sp.sort) as "days" | "total") : "name",
  };
  const { products, active, priority } = await listProducts(business.id, filters);
  const unit = (p: (typeof products)[number]) => (p.category === "peptide" ? "vials" : "units");

  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.heading}>Products</h1>
          <p className={ui.sub}>
            {active} active · {priority} of {MAX_PRIORITY} priority
          </p>
        </div>
        <div className={ui.actions}>
          <Link href="/admin/inventory/import" className={ui.secondary}>
            Bulk import
          </Link>
          <Link href="/admin/inventory/products/new" className={ui.primary}>
            Add product
          </Link>
        </div>
      </div>

      <ProductFiltersForm
        locations={locations}
        initial={{
          q: filters.search ?? "",
          category: filters.category ?? "",
          location: filters.locationId ?? "",
          sort: filters.sort ?? "name",
          priority: !!filters.priorityOnly,
          inactive: !!filters.includeInactive,
        }}
      />

      {products.length === 0 ? (
        <section className={ui.panel}>
          <p className={ui.empty}>
            {active === 0
              ? "No products yet. Add one, or bring them all in at once with Bulk import."
              : "No products match these filters."}
          </p>
        </section>
      ) : (
        <>
          <section className={`${ui.panel} inv-hide-tablet`} aria-label="Products">
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Sellable on hand</th>
                  <th>In testing</th>
                  <th className={ui.num}>Total</th>
                  <th className={ui.num}>Days</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className={p.isActive ? undefined : styles.inactive}>
                    <td>
                      <div className={styles.nameCell}>
                        <span className={styles.star} aria-label={p.isPriority ? "Priority" : undefined}>
                          {p.isPriority ? "★" : ""}
                        </span>
                        <div>
                          <Link href={`/admin/inventory/products/${p.id}`} className={styles.name}>
                            {p.strengthSize ? `${p.name} ${p.strengthSize}` : p.name}
                          </Link>
                          <div className={styles.meta}>
                            {CATEGORY_LABEL[p.category]}
                            {!p.isActive && " · Inactive"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{formatMix(p.sellable, p.forms)}</td>
                    <td className={styles.testing}>{formatInTesting(p.inTesting) ?? "—"}</td>
                    <td className={ui.num}>{p.total}</td>
                    <td className={ui.num}>{p.daysOfCover ?? "—"}</td>
                    <td>
                      <span className={`${ui.pill} ${ui[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <ul className={`${ui.cards} ${styles.cardGrid} inv-show-tablet`} aria-label="Products">
            {products.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/inventory/products/${p.id}`}
                  className={`${ui.card} ${styles.cardLink} ${p.isActive ? "" : styles.inactive}`}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>
                      {p.isPriority && (
                        <span className={styles.star} aria-label="Priority">
                          ★{" "}
                        </span>
                      )}
                      {p.strengthSize ? `${p.name} ${p.strengthSize}` : p.name}
                    </span>
                    <span className={`${ui.pill} ${ui[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                  </div>
                  <div className={styles.meta}>
                    {CATEGORY_LABEL[p.category]}
                    {!p.isActive && " · Inactive"}
                  </div>
                  <div>{formatMix(p.sellable, p.forms)}</div>
                  <div className={styles.cardStats}>
                    <span>
                      <b>{p.total}</b> {unit(p)}
                    </span>
                    <span>
                      <b>{p.daysOfCover ?? "—"}</b> days
                    </span>
                    {formatInTesting(p.inTesting) && (
                      <span className={styles.testing}>In testing {formatInTesting(p.inTesting)}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
