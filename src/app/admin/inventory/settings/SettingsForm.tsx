"use client";

import { useState, useTransition } from "react";
import ui from "../_components/ui.module.css";
import styles from "./settings.module.css";
import { saveSettingsAction } from "./actions";
import { label12 } from "./time-label";
import type { AlertSettings } from "@/lib/inventory/settings";

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

export function SettingsForm({ initial, defaultRecipients }: { initial: AlertSettings; defaultRecipients: string[] }) {
  const [v, setV] = useState({
    emailTime: initial.emailTime,
    recipients: initial.emailRecipients.join("\n"),
    coverDays: String(initial.coverDays),
    salesWindowDays: String(initial.salesWindowDays),
    testingOverdueDays: String(initial.testingOverdueDays),
    countMismatchThreshold: String(initial.countMismatchThreshold),
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setV({ ...v, [k]: e.target.value });
    setMsg(null);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const num = (s: string) => (/^\d{1,4}$/.test(s.trim()) ? Number(s) : NaN);
    startTransition(async () => {
      const r = await saveSettingsAction({
        emailTime: v.emailTime,
        emailRecipients: v.recipients.split(/[\s,;]+/).filter(Boolean),
        coverDays: num(v.coverDays),
        salesWindowDays: num(v.salesWindowDays),
        testingOverdueDays: num(v.testingOverdueDays),
        countMismatchThreshold: num(v.countMismatchThreshold),
      });
      setMsg(r.ok ? { ok: true, text: "Settings saved. The dashboard and email use them straight away." } : { ok: false, text: r.message });
    });
  };

  const field = (k: keyof typeof v, label: string, hint: string, unit: string) => (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={`st-${k}`}>{label}</label>
      <div className={ui.unitField}>
        <input id={`st-${k}`} inputMode="numeric" className={`${ui.input} ${styles.withUnit}`} value={v[k]} onChange={set(k)} />
        <span className={ui.unit} aria-hidden="true">{unit}</span>
      </div>
      <span className={ui.hint}>{hint}</span>
    </div>
  );

  return (
    <form className={ui.panel} onSubmit={save} aria-labelledby="st-alerts" noValidate>
      <h2 id="st-alerts" className={ui.panelTitle}>Alerts</h2>
      <div className={styles.grid}>
        {field("coverDays", "Days of cover target", "Priority products below this are flagged. Below 60 days shows Reorder.", "days")}
        {field("salesWindowDays", "Sales average over", "Days of sales used to work out sales per day.", "days")}
        {field("testingOverdueDays", "Testing overdue after", "Lots in testing longer than this are flagged.", "days")}
        {field("countMismatchThreshold", "Count mismatch over", "Count differences bigger than this are flagged.", "units")}
      </div>

      <h2 className={ui.panelTitle}>Email time and recipients</h2>
      <div className={styles.grid}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="st-time">Send at (Phoenix time)</label>
          <select id="st-time" className={ui.select} value={v.emailTime} onChange={set("emailTime")}>
            {TIMES.map((t) => <option key={t} value={t}>{label12(t)}</option>)}
          </select>
        </div>
        <div className={`${ui.field} ${styles.wide}`}>
          <label className={ui.label} htmlFor="st-recipients">Send to</label>
          <textarea
            id="st-recipients"
            className={`${ui.input} ${styles.textarea}`}
            value={v.recipients}
            onChange={set("recipients")}
            placeholder={defaultRecipients.length ? defaultRecipients.join("\n") : "one email address per line"}
          />
          <span className={ui.hint}>One email address per line. Leave empty to send to every manager of this business.</span>
        </div>
      </div>

      {msg && <p className={msg.ok ? ui.success : ui.error} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      <div className={ui.actions}>
        <button type="submit" className={ui.primary} disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
      </div>
    </form>
  );
}
