"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import ui from "../_components/ui.module.css";
import styles from "./movements.module.css";
import { MOVEMENT_TYPES, TYPE_LABEL } from "@/lib/inventory/movement-labels";

type Values = { from: string; to: string; type: string; product: string; who: string; order: string };

/** Filters kept in the address, so a filtered view (and its CSV) can be bookmarked or shared. */
export function MovementFiltersForm({
  initial, products, users,
}: { initial: Values; products: { id: string; label: string }[]; users: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();

  const apply = (next: Values) => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(next)) if (val.trim()) q.set(k, val.trim());
    startTransition(() => router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  const change = (patch: Partial<Values>, now = true) => {
    const next = { ...v, ...patch };
    setV(next);
    if (now) apply(next);
  };
  const empty = { from: "", to: "", type: "", product: "", who: "", order: "" };

  return (
    <form className={`${ui.panel} ${styles.filters}`} role="search" aria-busy={pending} onSubmit={(e) => { e.preventDefault(); apply(v); }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mv-from">From</label>
        <input id="mv-from" type="date" className={ui.input} value={v.from} onChange={(e) => change({ from: e.target.value })} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mv-to">To</label>
        <input id="mv-to" type="date" className={ui.input} value={v.to} onChange={(e) => change({ to: e.target.value })} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mv-type">Type</label>
        <select id="mv-type" className={ui.select} value={v.type} onChange={(e) => change({ type: e.target.value })}>
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mv-product">Product</label>
        <select id="mv-product" className={ui.select} value={v.product} onChange={(e) => change({ product: e.target.value })}>
          <option value="">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mv-who">Who</label>
        <select id="mv-who" className={ui.select} value={v.who} onChange={(e) => change({ who: e.target.value })}>
          <option value="">Everyone</option>
          <option value="website">Website (paid orders)</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mv-order">Order</label>
        <input
          id="mv-order"
          type="search"
          className={ui.input}
          value={v.order}
          placeholder="e.g. ORD-8841"
          onChange={(e) => change({ order: e.target.value }, false)}
          onBlur={() => apply(v)}
        />
      </div>
      <div className={styles.filterActions}>
        <button type="submit" className={ui.primary}>Apply</button>
        <button type="button" className={ui.secondary} onClick={() => { setV(empty); apply(empty); }}>Clear filters</button>
      </div>
    </form>
  );
}
