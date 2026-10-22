"use client";

import { useState, useTransition } from "react";
import ui from "../_components/ui.module.css";
import styles from "../_components/stock-forms.module.css";
import { transferAction } from "../stock-actions";
import { StockLinePicker, findLine, type StockPick } from "../_components/StockLinePicker";
import type { StockOption } from "@/lib/inventory/stock-reads";

const UNIT = { kit: "kits", half_kit: "half kits", vial: "vials", unit: "units" } as const;
const ONE = { kit: "kit", half_kit: "half kit", vial: "vial", unit: "unit" } as const;
const units = (t: keyof typeof ONE, n: number) => (n === 1 ? ONE[t] : UNIT[t]);

export function TransferForm({ stock, locations }: { stock: StockOption[]; locations: { id: string; name: string }[] }) {
  const [pick, setPick] = useState<StockPick>({ variantId: "", lineId: "" });
  const [toId, setToId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const line = findLine(stock, pick);
  const n = /^\d{1,6}$/.test(quantity.trim()) ? Number(quantity) : 0;
  const to = locations.find((l) => l.id === toId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!line) return setMessage({ ok: false, text: "Choose the product, form and lot to move" });
    if (!to) return setMessage({ ok: false, text: "Choose where it’s going" });
    if (to.id === line.locationId) return setMessage({ ok: false, text: "Choose a different location to move to" });
    if (n < 1) return setMessage({ ok: false, text: "Quantity must be a whole number, at least 1" });
    if (n > line.quantity) return setMessage({ ok: false, text: `Only ${line.quantity} ${UNIT[line.packageType]} of lot ${line.lotNumber} at ${line.location}` });
    startTransition(async () => {
      const r = await transferAction({ variantId: line.variantId, lotId: line.lotId, fromLocationId: line.locationId, toLocationId: to.id, quantity: n });
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setMessage({ ok: true, text: `Moved ${n} ${units(line.packageType, n)} of ${line.product} (lot ${line.lotNumber}) from ${line.location} to ${to.name}.` });
      setQuantity("");
      setPick({ variantId: "", lineId: "" });
      setToId("");
    });
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <section className={ui.panel} aria-label="Move stock">
        <div className={styles.grid}>
          <StockLinePicker stock={stock} value={pick} onChange={(v) => { setPick(v); setMessage(null); }} idPrefix="tr" lineLabel="From (lot and location)" />
          <div className={ui.field}>
            <label className={ui.label} htmlFor="tr-to">To</label>
            <select id="tr-to" className={ui.select} value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Choose…</option>
              {locations.filter((l) => l.id !== line?.locationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="tr-qty">Quantity{line ? ` (${UNIT[line.packageType]})` : ""}</label>
            <input id="tr-qty" inputMode="numeric" className={`${ui.input} ${ui.mono}`} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
            {line && <span className={styles.available}>{line.quantity} on that shelf</span>}
          </div>
        </div>
        {line && to && n > 0 && (
          <p className={styles.summary}>{line.location}: −{n} → {to.name}: +{n} {UNIT[line.packageType]}, lot {line.lotNumber}.</p>
        )}
      </section>

      {message && <p className={message.ok ? ui.success : ui.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}

      <div className={ui.actions}>
        <button type="submit" className={ui.primary} disabled={pending}>{pending ? "Moving…" : "Move stock"}</button>
      </div>
    </form>
  );
}
