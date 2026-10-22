"use client";

import { useMemo, useState, useTransition } from "react";
import ui from "../_components/ui.module.css";
import styles from "../_components/stock-forms.module.css";
import { breakDownAction } from "../stock-actions";
import type { StockOption } from "@/lib/inventory/stock-reads";

const SIZE = { kit: 10, half_kit: 5 } as const;
const STATUS = { passed: "Passed", in_testing: "In testing", failed: "Failed" } as const;
const lineKey = (s: StockOption) => `${s.lotId}|${s.locationId}`;

/** Oldest Passed line first; in-testing lots only if nothing has passed. */
function defaultLine(lines: StockOption[]) {
  return lines.find((l) => l.testingStatus === "passed") ?? lines[0];
}

export function BreakDownForm({ stock, racks }: { stock: StockOption[]; racks: { id: string; name: string }[] }) {
  const products = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stock) m.set(s.productId, s.product);
    return [...m];
  }, [stock]);

  const formsFor = (pid: string) => (["kit", "half_kit"] as const).filter((t) => stock.some((s) => s.productId === pid && s.packageType === t));
  const [chosenProduct, setProductId] = useState(products[0][0]);
  const [chosenForm, setForm] = useState<"kit" | "half_kit">(formsFor(products[0][0])[0]);
  // After a break down the page refreshes; if the chosen kits ran out, fall back to what is left.
  const productId = products.some(([id]) => id === chosenProduct) ? chosenProduct : products[0][0];
  const form = formsFor(productId).includes(chosenForm) ? chosenForm : formsFor(productId)[0];
  const lines = stock.filter((s) => s.productId === productId && s.packageType === form);
  const [lineId, setLineId] = useState(lineKey(defaultLine(lines)));
  const [toId, setToId] = useState(racks[0]?.id ?? "");
  const [count, setCount] = useState("1");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const line = lines.find((l) => lineKey(l) === lineId) ?? defaultLine(lines);
  const n = /^\d{1,3}$/.test(count) ? Number(count) : 0;
  const to = racks.find((r) => r.id === toId);
  const kitWord = form === "kit" ? (n === 1 ? "kit" : "kits") : (n === 1 ? "half kit" : "half kits");

  const chooseProduct = (pid: string) => {
    setProductId(pid);
    const f = formsFor(pid)[0];
    setForm(f);
    setLineId(lineKey(defaultLine(stock.filter((s) => s.productId === pid && s.packageType === f))));
    setMessage(null);
  };
  const chooseForm = (f: "kit" | "half_kit") => {
    setForm(f);
    setLineId(lineKey(defaultLine(stock.filter((s) => s.productId === productId && s.packageType === f))));
    setMessage(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (n < 1) return setMessage({ ok: false, text: "How many to open must be a whole number, at least 1" });
    if (n > line.quantity) return setMessage({ ok: false, text: `Only ${line.quantity} of lot ${line.lotNumber} at ${line.location}` });
    startTransition(async () => {
      const r = await breakDownAction({ variantId: line.variantId, lotId: line.lotId, fromLocationId: line.locationId, toLocationId: toId, count: n });
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setMessage({ ok: true, text: `Done: ${r.data.vials} vials of ${line.product} (lot ${r.data.lot}) added to ${r.data.to}.` });
      setCount("1");
    });
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <section className={ui.panel} aria-label="Break down">
        <div className={styles.grid}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="bd-product">Product</label>
            <select id="bd-product" className={ui.select} value={productId} onChange={(e) => chooseProduct(e.target.value)}>
              {products.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="bd-form">Open a</label>
            <select id="bd-form" className={ui.select} value={form} onChange={(e) => chooseForm(e.target.value as "kit" | "half_kit")}>
              {formsFor(productId).map((f) => <option key={f} value={f}>{f === "kit" ? "Kit (10 vials)" : "Half kit (5 vials)"}</option>)}
            </select>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="bd-lot">Lot and where it is</label>
            <select id="bd-lot" className={ui.select} value={lineKey(line)} onChange={(e) => setLineId(e.target.value)}>
              {lines.map((l) => (
                <option key={lineKey(l)} value={lineKey(l)}>
                  Lot {l.lotNumber} · {l.location} · {l.quantity} left · {STATUS[l.testingStatus]}
                </option>
              ))}
            </select>
            <span className={styles.available}>Oldest Passed lot is chosen first.</span>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="bd-count">How many to open</label>
            <input id="bd-count" inputMode="numeric" className={`${ui.input} ${ui.mono}`} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="bd-to">Vials go to</label>
            <select id="bd-to" className={ui.select} value={toId} onChange={(e) => setToId(e.target.value)}>
              {racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        {n > 0 && (
          <p className={styles.summary}>
            {line.location}: −{n} {kitWord} → {to?.name}: +{n * SIZE[form]} loose vials, same lot ({line.lotNumber}).
          </p>
        )}
        {line.testingStatus === "in_testing" && (
          <p className={ui.hint}>Lot {line.lotNumber} is still in testing, so its vials can’t be sold until it passes.</p>
        )}
      </section>

      {message && <p className={message.ok ? ui.success : ui.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}

      <div className={ui.actions}>
        <button type="submit" className={ui.primary} disabled={pending}>{pending ? "Saving…" : "Confirm break down"}</button>
      </div>
    </form>
  );
}
