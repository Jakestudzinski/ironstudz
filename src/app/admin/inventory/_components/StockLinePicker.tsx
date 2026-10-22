"use client";

import { useMemo } from "react";
import ui from "./ui.module.css";
import type { StockOption } from "@/lib/inventory/stock-reads";

const FORM = { kit: "Kit", half_kit: "Half kit", vial: "Vial", unit: "Unit" } as const;
const STATUS = { passed: "Passed", in_testing: "In testing", failed: "Failed" } as const;
export const lineKey = (s: StockOption) => `${s.lotId}|${s.locationId}`;

export type StockPick = { variantId: string; lineId: string };

/** Two linked pickers: product and form, then which lot and shelf it comes from. */
export function StockLinePicker({
  stock, value, onChange, idPrefix, lineLabel,
}: {
  stock: StockOption[];
  value: StockPick;
  onChange: (v: StockPick) => void;
  idPrefix: string;
  lineLabel: string;
}) {
  const variants = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stock) m.set(s.variantId, `${s.product} · ${FORM[s.packageType]}`);
    return [...m];
  }, [stock]);
  const lines = stock.filter((s) => s.variantId === value.variantId);

  return (
    <>
      <div className={ui.field}>
        <label className={ui.label} htmlFor={`${idPrefix}-variant`}>Product and form</label>
        <select
          id={`${idPrefix}-variant`}
          className={ui.select}
          value={value.variantId}
          onChange={(e) => {
            const first = stock.find((s) => s.variantId === e.target.value);
            onChange({ variantId: e.target.value, lineId: first ? lineKey(first) : "" });
          }}
        >
          <option value="">Choose…</option>
          {variants.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor={`${idPrefix}-line`}>{lineLabel}</label>
        <select
          id={`${idPrefix}-line`}
          className={ui.select}
          value={value.lineId}
          disabled={!value.variantId}
          onChange={(e) => onChange({ ...value, lineId: e.target.value })}
        >
          {!value.variantId && <option value="">Choose a product first</option>}
          {lines.map((l) => (
            <option key={lineKey(l)} value={lineKey(l)}>
              Lot {l.lotNumber} · {l.location} · {l.quantity} on shelf · {STATUS[l.testingStatus]}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export function findLine(stock: StockOption[], pick: StockPick) {
  return stock.find((s) => s.variantId === pick.variantId && lineKey(s) === pick.lineId);
}
