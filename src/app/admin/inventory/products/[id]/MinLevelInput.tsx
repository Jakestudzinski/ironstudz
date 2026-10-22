"use client";

import { useState, useTransition } from "react";
import ui from "../../_components/ui.module.css";
import styles from "./detail.module.css";
import { setMinLevelAction } from "../actions";

/** Min level box that saves when you leave it (or press Enter). */
export function MinLevelInput({ variantId, initial, label }: { variantId: string; initial: number; label: string }) {
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState(String(initial));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `min-${variantId}`;

  const save = () => {
    if (value.trim() === saved) return;
    if (!/^\d{1,6}$/.test(value.trim())) {
      setMessage({ ok: false, text: "Whole number, 0 or more" });
      return;
    }
    const next = value.trim();
    startTransition(async () => {
      const r = await setMinLevelAction(variantId, Number(next));
      if (r.ok) {
        setSaved(next);
        setMessage({ ok: true, text: "Saved" });
      } else {
        setMessage({ ok: false, text: r.message });
      }
    });
  };

  return (
    <div className={styles.minLevel}>
      <label htmlFor={id} className={styles.minLabel}>Min level</label>
      <input
        id={id}
        aria-label={label}
        inputMode="numeric"
        className={`${ui.input} ${ui.mono}`}
        value={value}
        disabled={pending}
        aria-invalid={message?.ok === false}
        onChange={(e) => { setValue(e.target.value); setMessage(null); }}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
      />
      <span role="status" className={message?.ok === false ? ui.inlineError : ui.inlineOk}>{message?.text ?? ""}</span>
    </div>
  );
}
