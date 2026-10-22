"use client";

import { useState, useTransition } from "react";
import ui from "../_components/ui.module.css";
import styles from "../_components/stock-forms.module.css";
import { adjustAction } from "../stock-actions";
import { StockLinePicker, findLine, type StockPick } from "../_components/StockLinePicker";
import { ADJUST_REASONS, REASON_LABEL, type AdjustReason } from "@/lib/inventory/operation-labels";
import type { StockOption, VariantOption } from "@/lib/inventory/stock-reads";

const UNIT = { kit: "kits", half_kit: "half kits", vial: "vials", unit: "units" } as const;
const ONE = { kit: "kit", half_kit: "half kit", vial: "vial", unit: "unit" } as const;
const units = (t: keyof typeof ONE, n: number) => (n === 1 ? ONE[t] : UNIT[t]);
const STATUS = { passed: "Passed", in_testing: "In testing", failed: "Failed" } as const;

type Props = {
  stock: StockOption[];
  variants: VariantOption[];
  lots: { id: string; productId: string; lotNumber: string; testingStatus: "passed" | "in_testing" | "failed" }[];
  locations: { id: string; name: string }[];
};

export function AdjustForm({ stock, variants, lots, locations }: Props) {
  const [direction, setDirection] = useState<"remove" | "add">("remove");
  const [pick, setPick] = useState<StockPick>({ variantId: "", lineId: "" });
  const [addVariant, setAddVariant] = useState("");
  const [addLot, setAddLot] = useState("");
  const [addLocation, setAddLocation] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<AdjustReason | "">("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const n = /^\d{1,6}$/.test(quantity.trim()) ? Number(quantity) : 0;
  const line = findLine(stock, pick);
  const variant = variants.find((v) => v.id === addVariant);
  const productLots = variant ? lots.filter((l) => l.productId === variant.productId) : [];

  const reset = () => {
    setPick({ variantId: "", lineId: "" }); setAddVariant(""); setAddLot(""); setAddLocation("");
    setQuantity(""); setReason(""); setNote("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    let target: { variantId: string; lotId: string; locationId: string; what: string; unit: string; lot: string; where: string };
    if (direction === "remove") {
      if (!line) return setMessage({ ok: false, text: "Choose the product, form and shelf to take stock from" });
      if (n > line.quantity) return setMessage({ ok: false, text: `Only ${line.quantity} ${UNIT[line.packageType]} of lot ${line.lotNumber} at ${line.location}` });
      target = { variantId: line.variantId, lotId: line.lotId, locationId: line.locationId, what: line.product, unit: units(line.packageType, n), lot: line.lotNumber, where: line.location };
    } else {
      if (!variant) return setMessage({ ok: false, text: "Choose the product and form to add" });
      const lot = productLots.find((l) => l.id === addLot);
      if (!lot) return setMessage({ ok: false, text: "Choose which lot it belongs to. New deliveries go through Receive stock." });
      const locationId = addLocation || variant.homeLocationId;
      const loc = locations.find((l) => l.id === locationId);
      if (!loc) return setMessage({ ok: false, text: "Choose where it is" });
      target = { variantId: variant.id, lotId: lot.id, locationId: loc.id, what: variant.label.split(" · ")[0], unit: units(variant.packageType, n), lot: lot.lotNumber, where: loc.name };
    }
    if (n < 1) return setMessage({ ok: false, text: "Quantity must be a whole number, at least 1" });
    if (!reason) return setMessage({ ok: false, text: "Choose a reason" });
    if (reason === "other" && !note.trim()) return setMessage({ ok: false, text: "Add a note explaining the adjustment" });

    startTransition(async () => {
      const r = await adjustAction({
        variantId: target.variantId, lotId: target.lotId, locationId: target.locationId, direction, quantity: n, reason, note,
      });
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setMessage({
        ok: true,
        text: `${direction === "add" ? "Added" : "Removed"} ${n} ${target.unit} of ${target.what} (lot ${target.lot}) ${direction === "add" ? "at" : "from"} ${target.where} · ${REASON_LABEL[reason]}.`,
      });
      reset();
    });
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <section className={ui.panel} aria-label="Adjustment">
        <fieldset className={`${styles.choice} ${styles.fieldset}`}>
          <legend className={`${ui.label} ${styles.legend}`}>Adjustment</legend>
          <label><input type="radio" name="direction" checked={direction === "remove"} onChange={() => { setDirection("remove"); setMessage(null); }} /> Remove stock</label>
          <label><input type="radio" name="direction" checked={direction === "add"} onChange={() => { setDirection("add"); setMessage(null); }} /> Add stock</label>
        </fieldset>

        <div className={styles.grid}>
          {direction === "remove" ? (
            <StockLinePicker stock={stock} value={pick} onChange={setPick} idPrefix="ad" lineLabel="From (lot and location)" />
          ) : (
            <>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="ad-add-variant">Product and form</label>
                <select id="ad-add-variant" className={ui.select} value={addVariant} onChange={(e) => { setAddVariant(e.target.value); setAddLot(""); setAddLocation(""); }}>
                  <option value="">Choose…</option>
                  {variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="ad-add-lot">Lot</label>
                <select id="ad-add-lot" className={ui.select} value={addLot} onChange={(e) => setAddLot(e.target.value)} disabled={!variant}>
                  <option value="">{variant ? (productLots.length ? "Choose…" : "No lots yet: use Receive stock") : "Choose a product first"}</option>
                  {productLots.map((l) => <option key={l.id} value={l.id}>Lot {l.lotNumber} · {STATUS[l.testingStatus]}</option>)}
                </select>
              </div>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="ad-add-loc">Location</label>
                <select id="ad-add-loc" className={ui.select} value={addLocation} onChange={(e) => setAddLocation(e.target.value)}>
                  <option value="">{variant?.homeLocation ? `Home location (${variant.homeLocation})` : "Choose…"}</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </>
          )}
          <div className={ui.field}>
            <label className={ui.label} htmlFor="ad-qty">Quantity</label>
            <input id="ad-qty" inputMode="numeric" className={`${ui.input} ${ui.mono}`} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
            {direction === "remove" && line && <span className={styles.available}>{line.quantity} on that shelf</span>}
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="ad-reason">Reason</label>
            <select id="ad-reason" className={ui.select} value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
              <option value="">Choose…</option>
              {ADJUST_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </div>
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="ad-note">Note{reason === "other" ? " (required)" : " (optional)"}</label>
          <textarea id="ad-note" className={`${ui.input} ${styles.textarea}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </div>
      </section>

      {message && <p className={message.ok ? ui.success : ui.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}

      <div className={ui.actions}>
        <button type="submit" className={ui.primary} disabled={pending}>{pending ? "Saving…" : "Save adjustment"}</button>
      </div>
    </form>
  );
}
