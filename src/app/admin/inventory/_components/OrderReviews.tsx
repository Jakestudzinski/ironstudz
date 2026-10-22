"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import ui from "./ui.module.css";
import styles from "./reviews.module.css";
import { markCancelledReviewedAction, resolveIssueAction } from "../stock-actions";

type Msg = { ok: boolean; text: string } | null;

/** Paid orders that were cancelled or refunded: check the shelf, put stock back on Adjust if needed, mark reviewed. */
export function CancelledOrders({ orders }: { orders: { id: string; title: string; when: string }[] }) {
  const [message, setMessage] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();

  const review = (id: string, title: string) =>
    startTransition(async () => {
      const r = await markCancelledReviewedAction(id);
      setMessage(r.ok ? { ok: true, text: `${title.split(" · ")[0]} marked reviewed.` } : { ok: false, text: r.message });
    });

  return (
    <section className={ui.panel} aria-labelledby="dash-cancelled">
      <div className={ui.panelHead}>
        <h2 id="dash-cancelled" className={ui.panelTitle}>Cancelled orders to review</h2>
        <p className={ui.hint}>Check the shelf, add stock back if needed, then mark reviewed</p>
      </div>
      {message && <p className={message.ok ? ui.success : ui.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      {orders.length === 0 ? (
        <p className={styles.allDone}>All cancelled orders reviewed.</p>
      ) : (
        <ul className={ui.lines}>
          {orders.map((o) => (
            <li key={o.id} className={styles.row}>
              <div className={styles.text}>
                <b>{o.title}</b>
                <span className={styles.muted}>{o.when}</span>
              </div>
              <button type="button" className={styles.outline} disabled={pending} onClick={() => review(o.id, o.title)}>
                Mark reviewed
              </button>
            </li>
          ))}
        </ul>
      )}
      {orders.length > 0 && (
        <Link href="/admin/inventory/adjust" className={styles.adjustLink}>Add stock back on the Adjust screen →</Link>
      )}
    </section>
  );
}

/** Unknown SKUs and shortfalls from paid orders. Resolving one needs a short note. */
export function OrderIssues({ issues }: { issues: { id: string; title: string; info: string }[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();

  const resolve = (id: string, title: string) =>
    startTransition(async () => {
      const r = await resolveIssueAction(id, note);
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setMessage({ ok: true, text: `${title.split(" · ")[0]} issue resolved.` });
      setOpenId(null);
      setNote("");
    });

  return (
    <section className={ui.panel} aria-labelledby="dash-issues">
      <div className={ui.panelHead}>
        <h2 id="dash-issues" className={ui.panelTitle}>Order issues</h2>
        <p className={ui.hint}>The order went through, but these items couldn’t be taken from stock</p>
      </div>
      {message && <p className={message.ok ? ui.success : ui.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      <ul className={ui.lines}>
        {issues.map((i) => (
          <li key={i.id} className={styles.issue}>
            <div className={styles.row}>
              <div className={styles.text}>
                <b>{i.title}</b>
                <span className={styles.muted}>{i.info}</span>
              </div>
              {openId !== i.id && (
                <button type="button" className={styles.outline} onClick={() => { setOpenId(i.id); setNote(""); setMessage(null); }}>
                  Resolve
                </button>
              )}
            </div>
            {openId === i.id && (
              <form className={styles.resolve} onSubmit={(e) => { e.preventDefault(); resolve(i.id, i.title); }}>
                <div className={ui.field}>
                  <label className={ui.label} htmlFor={`res-${i.id}`}>What was done?</label>
                  <input
                    id={`res-${i.id}`}
                    className={ui.input}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. SKU fixed on the website, or sent from another lot"
                    autoComplete="off"
                  />
                </div>
                <div className={styles.buttons}>
                  <button type="submit" className={ui.primary} disabled={pending}>Mark resolved</button>
                  <button type="button" className={ui.secondary} disabled={pending} onClick={() => setOpenId(null)}>Cancel</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
