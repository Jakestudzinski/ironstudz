"use client";

import { useState, useTransition } from "react";
import ui from "./ui.module.css";
import styles from "./keys.module.css";
import { createApiKeyAction, revokeApiKeyAction } from "../owner-actions";

type Key = { id: string; label: string; createdAt: string; revokedAt: string | null };
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

/** Website API keys for one business (owners only). A new key is shown once; only its fingerprint is stored. */
export function ApiKeys({ businessId, businessName, keys }: { businessId: string; businessName: string; keys: Key[] }) {
  const [label, setLabel] = useState("Website");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const active = keys.filter((k) => !k.revokedAt);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const r = await createApiKeyAction(businessId, label);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setNewKey(r.data);
      setCopied(false);
    });
  };
  const revoke = (keyId: string, keyLabel: string) =>
    startTransition(async () => {
      const r = await revokeApiKeyAction(businessId, keyId);
      setConfirm(null);
      setMsg(r.ok ? { ok: true, text: `Key “${keyLabel}” revoked. Orders sent with it are now refused.` } : { ok: false, text: r.message });
    });
  const copy = async () => {
    try { await navigator.clipboard.writeText(newKey!); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className={styles.keys}>
      {newKey && (
        <div className={styles.newKey} role="status">
          <b>New key for {businessName}. Copy it now: it won’t be shown again.</b>
          <code className={styles.code}>{newKey}</code>
          <div className={styles.row}>
            <button type="button" className={ui.primary} onClick={copy}>{copied ? "Copied" : "Copy key"}</button>
            <button type="button" className={ui.secondary} onClick={() => setNewKey(null)}>I’ve saved it</button>
          </div>
          <span className={ui.hint}>
            The website sends it as <code>Authorization: Bearer &lt;key&gt;</code> to <code>/api/inventory/inbound/orders</code>.
          </span>
        </div>
      )}

      {keys.length === 0 ? (
        <p className={ui.empty}>No key yet, so this business’s website can’t send orders.</p>
      ) : (
        <ul className={ui.lines}>
          {keys.map((k) => (
            <li key={k.id} className={styles.keyRow}>
              <span>
                <b>{k.label}</b>
                <span className={styles.muted}> · created {day(k.createdAt)}{k.revokedAt ? ` · revoked ${day(k.revokedAt)}` : ""}</span>
              </span>
              {k.revokedAt ? (
                <span className={`${ui.pill} ${ui.neutral}`}>Revoked</span>
              ) : confirm === k.id ? (
                <span className={styles.row}>
                  <button type="button" className={styles.danger} disabled={pending} onClick={() => revoke(k.id, k.label)}>Yes, revoke</button>
                  <button type="button" className={ui.secondary} disabled={pending} onClick={() => setConfirm(null)}>Keep</button>
                </span>
              ) : (
                <button type="button" className={ui.secondary} disabled={pending} onClick={() => setConfirm(k.id)}>Revoke</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <p className={ui.hint}>Revoking stops the website’s orders reaching inventory until it’s given a new key.</p>
      )}

      <form className={styles.create} onSubmit={create}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor={`key-label-${businessId}`}>{active.length ? "Another key, named" : "New key, named"}</label>
          <input id={`key-label-${businessId}`} className={ui.input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </div>
        <button type="submit" className={ui.secondary} disabled={pending}>Create API key</button>
      </form>
      {msg && <p className={msg.ok ? ui.success : ui.error} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </div>
  );
}
