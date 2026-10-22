"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import ui from "../_components/ui.module.css";
import styles from "./products.module.css";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/inventory/product-meta";

type Values = { q: string; category: string; location: string; sort: string; priority: boolean; inactive: boolean };

/** Search, filters and sort. Kept in the address so a filtered list can be bookmarked or shared. */
export function ProductFiltersForm({ locations, initial }: { locations: { id: string; name: string }[]; initial: Values }) {
  const router = useRouter();
  const pathname = usePathname();
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (v: Values) => {
    const p = new URLSearchParams();
    if (v.q.trim()) p.set("q", v.q.trim());
    if (v.category) p.set("category", v.category);
    if (v.location) p.set("location", v.location);
    if (v.sort !== "name") p.set("sort", v.sort);
    if (v.priority) p.set("priority", "1");
    if (v.inactive) p.set("inactive", "1");
    startTransition(() => router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false }));
  };
  const change = (patch: Partial<Values>, wait = 0) => {
    const next = { ...values, ...patch };
    setValues(next);
    if (typing.current) clearTimeout(typing.current);
    typing.current = setTimeout(() => apply(next), wait);
  };
  useEffect(() => () => { if (typing.current) clearTimeout(typing.current); }, []);

  return (
    <form
      className={`${ui.panel} ${styles.filters}`}
      role="search"
      aria-busy={pending}
      onSubmit={(e) => { e.preventDefault(); apply(values); }}
    >
      <div className={`${ui.field} ${styles.search}`}>
        <label className={ui.label} htmlFor="pf-q">Search</label>
        <input
          id="pf-q"
          type="search"
          className={ui.input}
          placeholder="Name, strength or SKU"
          value={values.q}
          onChange={(e) => change({ q: e.target.value }, 350)}
        />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="pf-category">Category</label>
        <select id="pf-category" className={ui.select} value={values.category} onChange={(e) => change({ category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="pf-location">Location</label>
        <select id="pf-location" className={ui.select} value={values.location} onChange={(e) => change({ location: e.target.value })}>
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="pf-sort">Sort by</label>
        <select id="pf-sort" className={ui.select} value={values.sort} onChange={(e) => change({ sort: e.target.value })}>
          <option value="name">Name</option>
          <option value="days">Days of cover (fewest first)</option>
          <option value="total">Total on hand (most first)</option>
        </select>
      </div>
      <div className={styles.checks}>
        <label className={ui.check}>
          <input type="checkbox" checked={values.priority} onChange={(e) => change({ priority: e.target.checked })} />
          Priority products only
        </label>
        <label className={ui.check}>
          <input type="checkbox" checked={values.inactive} onChange={(e) => change({ inactive: e.target.checked })} />
          Show inactive products
        </label>
      </div>
    </form>
  );
}
