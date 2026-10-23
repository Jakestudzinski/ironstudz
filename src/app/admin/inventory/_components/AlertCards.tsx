"use client";

import { useState } from "react";
import Link from "next/link";
import ui from "./ui.module.css";
import styles from "./alerts.module.css";
import type { AlertKey, Alerts } from "@/lib/inventory/alerts";

const ORDER: AlertKey[] = ["cover", "refill", "low", "testing", "count"];

/** "Needs attention today": one card per alert; tap a card to list what's behind it, each linking to the fix. */
export function AlertCards({ alerts }: { alerts: Alerts }) {
  const [open, setOpen] = useState<AlertKey | null>(null);
  const active = open ? alerts[open] : null;

  return (
    <section aria-labelledby="dash-alerts" className={styles.section}>
      <div className={styles.head}>
        <h2 id="dash-alerts" className={styles.title}>Needs attention today</h2>
        <p className={ui.hint}>Tap a card to see what’s behind it</p>
      </div>
      <div className={styles.cards}>
        {ORDER.map((k) => {
          const a = alerts[k];
          const n = a.items.length;
          return (
            <button
              key={k}
              type="button"
              className={`${styles.card} ${n ? styles.hasItems : ""}`}
              aria-expanded={open === k}
              aria-controls={open === k ? "dash-alert-detail" : undefined}
              onClick={() => setOpen(open === k ? null : k)}
            >
              <span className={`${styles.count} ${n ? styles.bad : styles.good}`}>{n}</span>
              <span className={styles.label}>{a.label}</span>
            </button>
          );
        })}
      </div>
      {active && (
        <div id="dash-alert-detail" className={ui.panel}>
          <div className={styles.detailHead}>
            <h3 className={ui.panelTitle}>{active.title}</h3>
            <button type="button" className={ui.secondary} onClick={() => setOpen(null)}>Close</button>
          </div>
          {active.items.length === 0 ? (
            <p className={ui.empty}>Nothing here right now.</p>
          ) : (
            <ul className={ui.lines}>
              {active.items.map((i) => (
                <li key={i.id}>
                  <Link href={i.href} className={styles.item}>
                    <span className={styles.itemName}>{i.name}</span>
                    <span className={styles.itemInfo}>{i.info}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
