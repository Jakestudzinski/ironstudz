"use client";

import { useState, useTransition } from "react";
import ui from "../../_components/ui.module.css";
import styles from "./detail.module.css";
import { setActiveAction, setPriorityAction } from "../actions";

/** Priority and Active checkboxes. Saved straight away; a refused change (e.g. priority limit) is undone and explained. */
export function ProductSwitches({ productId, isPriority, isActive }: { productId: string; isPriority: boolean; isActive: boolean }) {
  const [priority, setPriority] = useState(isPriority);
  const [active, setActive] = useState(isActive);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (kind: "priority" | "active", on: boolean) => {
    const set = kind === "priority" ? setPriority : setActive;
    set(on);
    setMessage(null);
    startTransition(async () => {
      const r = kind === "priority" ? await setPriorityAction(productId, on) : await setActiveAction(productId, on);
      if (r.ok) {
        setMessage({ ok: true, text: "Saved" });
      } else {
        set(!on);
        setMessage({ ok: false, text: r.message });
      }
    });
  };

  return (
    <div className={styles.switches}>
      <label className={ui.check}>
        <input type="checkbox" checked={priority} disabled={pending} onChange={(e) => save("priority", e.target.checked)} />
        <b>Priority product (90-day alert)</b>
      </label>
      <label className={ui.check}>
        <input type="checkbox" checked={active} disabled={pending} onChange={(e) => save("active", e.target.checked)} />
        <b>Active</b>
      </label>
      <span role="status" className={message?.ok === false ? ui.inlineError : ui.inlineOk}>{message?.text ?? ""}</span>
    </div>
  );
}
