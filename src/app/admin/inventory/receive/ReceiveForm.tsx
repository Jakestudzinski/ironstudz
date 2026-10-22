"use client";

import { useState, useTransition } from "react";
import ui from "../_components/ui.module.css";
import styles from "../_components/stock-forms.module.css";
import { receiveStockAction } from "../stock-actions";
import type { VariantOption } from "@/lib/inventory/stock-reads";

type Line = { key: number; variantId: string; lot: string; quantity: string; location: string };

const UNIT_WORD = { kit: "kits", half_kit: "half kits", vial: "vials", unit: "units" } as const;
const ONE = { kit: "kit", half_kit: "half kit", vial: "vial", unit: "unit" } as const;
const units = (t: keyof typeof ONE, n: number) => (n === 1 ? ONE[t] : UNIT_WORD[t]);

export function ReceiveForm({ variants, locations }: { variants: VariantOption[]; locations: { id: string; name: string }[] }) {
  const blank = (key: number): Line => ({ key, variantId: "", lot: "", quantity: "", location: "" });
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([blank(1)]);
  const [nextKey, setNextKey] = useState(2);
  const [message, setMessage] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = new Map(variants.map((v) => [v.id, v]));
  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!reference.trim()) return setMessage({ ok: false, text: "Enter the delivery reference, e.g. the PO number" });
    for (const [i, l] of lines.entries()) {
      const n = `Line ${i + 1}: `;
      if (!l.variantId) return setMessage({ ok: false, text: n + "choose the product and form" });
      if (!l.lot.trim()) return setMessage({ ok: false, text: n + "enter the lot number from the delivery" });
      if (!/^\d{1,6}$/.test(l.quantity.trim()) || Number(l.quantity) < 1) return setMessage({ ok: false, text: n + "quantity must be a whole number, at least 1" });
      const v = byId.get(l.variantId)!;
      if (!l.location && !v.homeLocationId) return setMessage({ ok: false, text: n + `${v.label} has no home location, so choose where it goes` });
    }
    const payload = {
      reference,
      lines: lines.map((l) => ({
        sku: byId.get(l.variantId)!.sku, lot_number: l.lot.trim(), quantity: Number(l.quantity), location: l.location || undefined,
      })),
    };
    startTransition(async () => {
      const r = await receiveStockAction(payload);
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      if (r.data.duplicate) {
        return setMessage({ ok: false, text: `Delivery “${reference.trim()}” was already recorded, so nothing was added. Use a different reference for a new delivery.` });
      }
      setMessage({
        ok: true,
        text: `Delivery ${reference.trim()} recorded.`,
        details: r.data.lines.map((l, i) => {
          const v = byId.get(lines[i].variantId)!;
          const status = l.new_lot ? "new lot, In testing" : `added to existing lot (${l.lot_status === "passed" ? "Passed" : l.lot_status === "failed" ? "Failed" : "In testing"})`;
          return `${v.label}: ${l.quantity} ${units(v.packageType, l.quantity)} · Lot ${l.lot_number} · ${l.location === "home location" ? v.homeLocation : l.location} · ${status}`;
        }),
      });
      setReference("");
      setLines([blank(nextKey)]);
      setNextKey((k) => k + 1);
    });
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <section className={ui.panel} aria-labelledby="rc-delivery">
        <h2 id="rc-delivery" className={ui.panelTitle}>Delivery</h2>
        <div className={`${ui.field} ${styles.narrow}`}>
          <label className={ui.label} htmlFor="rc-ref">Delivery reference</label>
          <input id="rc-ref" className={ui.input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PO-118" autoComplete="off" />
          <span className={ui.hint}>Recording the same reference twice only adds the stock once.</span>
        </div>
      </section>

      <section className={ui.panel} aria-labelledby="rc-lines">
        <h2 id="rc-lines" className={ui.panelTitle}>What arrived</h2>
        <ol className={styles.lineList}>
          {lines.map((l, i) => {
            const v = byId.get(l.variantId);
            return (
              <li key={l.key} className={styles.receiveLine}>
                <div className={styles.lineHead}>
                  <b>Line {i + 1}</b>
                  {lines.length > 1 && (
                    <button type="button" className={styles.linkButton} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      Remove line {i + 1}
                    </button>
                  )}
                </div>
                <div className={styles.receiveGrid}>
                  <div className={`${ui.field} ${styles.span2}`}>
                    <label className={ui.label} htmlFor={`rc-v-${l.key}`}>Product and form</label>
                    <select id={`rc-v-${l.key}`} className={ui.select} value={l.variantId} onChange={(e) => patch(l.key, { variantId: e.target.value })}>
                      <option value="">Choose…</option>
                      {variants.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className={ui.field}>
                    <label className={ui.label} htmlFor={`rc-lot-${l.key}`}>Lot number</label>
                    <input id={`rc-lot-${l.key}`} className={`${ui.input} ${ui.mono}`} value={l.lot} onChange={(e) => patch(l.key, { lot: e.target.value })} placeholder="e.g. 2410H" autoComplete="off" autoCapitalize="characters" />
                  </div>
                  <div className={ui.field}>
                    <label className={ui.label} htmlFor={`rc-q-${l.key}`}>Quantity{v ? ` (${UNIT_WORD[v.packageType]})` : ""}</label>
                    <input id={`rc-q-${l.key}`} inputMode="numeric" className={`${ui.input} ${ui.mono}`} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} placeholder="0" />
                  </div>
                  <div className={`${ui.field} ${styles.span2}`}>
                    <label className={ui.label} htmlFor={`rc-loc-${l.key}`}>Location</label>
                    <select id={`rc-loc-${l.key}`} className={ui.select} value={l.location} onChange={(e) => patch(l.key, { location: e.target.value })}>
                      <option value="">{v?.homeLocation ? `Home location (${v.homeLocation})` : "Home location"}</option>
                      {locations.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" className={`${ui.secondary} ${styles.addLine}`} onClick={() => { setLines((ls) => [...ls, blank(nextKey)]); setNextKey((k) => k + 1); }}>
          Add another line
        </button>
      </section>

      {message && (
        <div className={message.ok ? ui.success : ui.error} role={message.ok ? "status" : "alert"}>
          {message.text}
          {message.details && <ul className={styles.details}>{message.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}

      <div className={ui.actions}>
        <button type="submit" className={ui.primary} disabled={pending}>{pending ? "Recording…" : "Record delivery"}</button>
      </div>
    </form>
  );
}
