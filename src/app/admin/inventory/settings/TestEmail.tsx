"use client";

import { useState, useTransition } from "react";
import ui from "../_components/ui.module.css";
import styles from "./settings.module.css";
import { sendTestEmailAction } from "./actions";

export function TestEmail() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const send = () =>
    startTransition(async () => {
      const r = await sendTestEmailAction();
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setMsg({
        ok: true,
        text: r.data.status === "sent"
          ? `Test email sent to ${r.data.to}.`
          : "Email isn’t set up yet, so nothing was sent. Use “Preview today’s email” to see what it would say.",
      });
    });
  return (
    <>
      <div className={styles.buttons}>
        <button type="button" className={ui.secondary} disabled={pending} onClick={send}>
          {pending ? "Sending…" : "Send test email now"}
        </button>
        <a href="/api/inventory/email-preview" target="_blank" rel="noopener" className={ui.secondary}>
          Preview today’s email
        </a>
      </div>
      {msg && <p className={msg.ok ? ui.success : ui.error} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </>
  );
}
