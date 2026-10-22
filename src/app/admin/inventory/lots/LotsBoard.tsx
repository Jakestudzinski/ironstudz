"use client";

import { useState } from "react";
import Link from "next/link";
import ui from "../_components/ui.module.css";
import styles from "./lots.module.css";
import { LotActions } from "./LotActions";
import type { LotRow } from "@/lib/inventory/stock-reads";

const FORM = { kit: ["kit", "kits"], half_kit: ["half kit", "half kits"], vial: ["vial", "vials"], unit: ["unit", "units"] } as const;
function stockText(l: LotRow) {
  const parts = (Object.keys(FORM) as (keyof typeof FORM)[])
    .filter((t) => (l.stock[t] ?? 0) > 0)
    .map((t) => `${l.stock[t]} ${FORM[t][l.stock[t] === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(" · ") : "No stock left";
}
const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric" }).format(new Date(iso));

type Lots = { inTesting: LotRow[]; failed: LotRow[]; passed: LotRow[] };
export type Flash = { ok: boolean; text: string } | null;

/**
 * The three lists of lots. Confirmations are shown at the top, because a lot moves to another list
 * (e.g. In testing → Passed) as soon as its result is saved.
 */
export function LotsBoard({ lots }: { lots: Lots }) {
  const [flash, setFlash] = useState<Flash>(null);

  const list = (rows: LotRow[], empty: string) =>
    rows.length === 0 ? (
      <p className={ui.empty}>{empty}</p>
    ) : (
      <ul className={ui.lines}>
        {rows.map((l) => (
          <li key={l.id} className={styles.lot}>
            <div className={styles.info}>
              <div className={styles.title}>
                <Link href={`/admin/inventory/products/${l.productId}`} className={styles.product}>{l.product}</Link>
                <span className={ui.mono}>Lot {l.lotNumber}</span>
                {l.status === "in_testing" && (
                  <span className={`${ui.pill} ${l.overdue ? ui.reorder : ui.in_testing}`}>{l.overdue ? "Overdue" : "In testing"}</span>
                )}
                {l.status === "passed" && <span className={`${ui.pill} ${ui.passed}`}>Passed</span>}
                {l.status === "failed" && <span className={`${ui.pill} ${ui.failed}`}>Failed</span>}
              </div>
              <div className={styles.meta}>
                {stockText(l)}
                {l.status === "in_testing"
                  ? ` · ${l.daysWaiting} ${l.daysWaiting === 1 ? "day" : "days"} in testing (received ${shortDate(l.receivedAt)})`
                  : ` · ${l.status === "passed" ? "passed" : "failed"} ${l.changedAt ? shortDate(l.changedAt) : ""}${l.changedBy ? ` by ${l.changedBy}` : ""}`}
              </div>
              {l.lastNote && <div className={styles.note}>“{l.lastNote}”</div>}
            </div>
            <LotActions
              lot={{ id: l.id, lotNumber: l.lotNumber, product: l.product, status: l.status, units: l.units, stockText: stockText(l) }}
              onDone={setFlash}
            />
          </li>
        ))}
      </ul>
    );

  return (
    <>
      {flash && (
        <p className={`${flash.ok ? ui.success : ui.error} ${styles.flash}`} role={flash.ok ? "status" : "alert"}>
          {flash.text}
          <button type="button" className={styles.dismiss} onClick={() => setFlash(null)} aria-label="Dismiss message">×</button>
        </p>
      )}

      <section className={ui.panel} aria-labelledby="lots-testing">
        <div className={ui.panelHead}>
          <h2 id="lots-testing" className={ui.panelTitle}>In testing</h2>
          <p className={ui.hint}>Oldest first. Stock can’t be sold until its lot passes.</p>
        </div>
        {list(lots.inTesting, "No lots are waiting on test results.")}
      </section>

      <section className={ui.panel} aria-labelledby="lots-failed">
        <div className={ui.panelHead}>
          <h2 id="lots-failed" className={ui.panelTitle}>Failed</h2>
          <p className={ui.hint}>Blocked from sale. Write off the stock once it’s thrown out. Shown until 30 days after it’s used up.</p>
        </div>
        {list(lots.failed, "No failed lots.")}
      </section>

      <section className={ui.panel} aria-labelledby="lots-passed">
        <div className={ui.panelHead}>
          <h2 id="lots-passed" className={ui.panelTitle}>Passed</h2>
          <p className={ui.hint}>Lots with stock left, plus any passed in the last 30 days. Most recent first.</p>
        </div>
        {list(lots.passed, "No passed lots yet.")}
      </section>
    </>
  );
}
