"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ui from "../_components/ui.module.css";
import styles from "./businesses.module.css";
import { ApiKeys } from "../_components/ApiKeys";
import { switchBusiness } from "../actions";
import {
  addManagerAction, createBusinessAction, removeManagerAction, setBusinessActiveAction,
} from "../owner-actions";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/inventory/product-meta";
import type { BusinessCard } from "@/lib/inventory/admin";

type Msg = { ok: boolean; text: string } | null;
const keyDay = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric" }).format(new Date(iso));

export function BusinessesBoard({
  businesses, activeId, managedIds, ownerId,
}: { businesses: BusinessCard[]; activeId: string | null; managedIds: string[]; ownerId: string }) {
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ name: string; key: string | null } | null>(null);

  return (
    <>
      {!adding && (
        <div className={ui.actions}>
          <button type="button" className={ui.primary} onClick={() => { setAdding(true); setCreated(null); }}>Add business</button>
        </div>
      )}
      {adding && <AddBusiness onDone={(c) => { setAdding(false); setCreated(c); }} onCancel={() => setAdding(false)} />}
      {created && (
        <div className={ui.success} role="status">
          {created.name} created. You’re its first manager; add the others with Edit managers below.
          {created.key && (
            <div className={styles.keyOnce}>
              <b>Its website API key. Copy it now: it won’t be shown again.</b>
              <code className={styles.code}>{created.key}</code>
            </div>
          )}
        </div>
      )}
      <ul className={styles.cards}>
        {businesses.map((b) => (
          <BusinessCardView key={b.id} b={b} active={b.id === activeId} manages={managedIds.includes(b.id)} ownerId={ownerId} />
        ))}
      </ul>
    </>
  );
}

function AddBusiness({ onDone, onCancel }: { onDone: (c: { name: string; key: string | null }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [sells, setSells] = useState<Category>("peptide");
  const [createKey, setCreateKey] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const r = await createBusinessAction({ name, sells, createKey });
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      onDone({ name: name.trim(), key: r.data.key });
    });
  };
  return (
    <form className={ui.panel} onSubmit={submit} aria-labelledby="biz-add" noValidate>
      <h2 id="biz-add" className={ui.panelTitle}>Add a business</h2>
      <div className={styles.addGrid}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="biz-name">Business name</label>
          <input id="biz-name" className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Studz Pre-workout" autoComplete="off" />
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="biz-sells">Mainly sells</label>
          <select id="biz-sells" className={ui.select} value={sells} onChange={(e) => setSells(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
      </div>
      <label className={ui.check}>
        <input type="checkbox" checked={createKey} onChange={(e) => setCreateKey(e.target.checked)} />
        Create a website API key now, so its website can send paid orders
      </label>
      {msg && <p className={ui.error} role="alert">{msg.text}</p>}
      <div className={ui.actions}>
        <button type="submit" className={ui.primary} disabled={pending}>{pending ? "Creating…" : "Create business"}</button>
        <button type="button" className={ui.secondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function BusinessCardView({ b, active, manages, ownerId }: { b: BusinessCard; active: boolean; manages: boolean; ownerId: string }) {
  const [panel, setPanel] = useState<"managers" | "keys" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const liveKeys = b.keys.filter((k) => !k.revokedAt);

  const toggleActive = () =>
    startTransition(async () => {
      const r = await setBusinessActiveAction(b.id, !b.isActive);
      setMsg(r.ok ? { ok: true, text: b.isActive ? `${b.name} switched off. Its managers no longer see it.` : `${b.name} switched back on.` } : { ok: false, text: r.message });
    });
  const open = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("businessId", b.id);
      await switchBusiness(fd);
      router.push("/admin/inventory");
    });

  return (
    <li className={`${styles.card} ${active ? styles.activeCard : ""} ${b.isActive ? "" : styles.off}`}>
      <div className={styles.cardTop}>
        <div>
          <h2 className={styles.name}>{b.name}</h2>
          <p className={styles.muted}>{b.sells ? CATEGORY_LABEL[b.sells as Category] : "Not set"} · {b.products} {b.products === 1 ? "product" : "products"}</p>
        </div>
        {active && <span className={`${ui.pill} ${ui.info}`}>Open now</span>}
        {!b.isActive && <span className={`${ui.pill} ${ui.neutral}`}>Switched off</span>}
      </div>
      <p className={styles.line}><b>Managers:</b> {b.managers.length ? b.managers.map((m) => (m.id === ownerId ? "You" : m.name)).join(", ") : "None yet"}</p>
      <span className={`${ui.pill} ${liveKeys.length ? ui.passed : ui.watch} ${styles.keyPill}`}>
        {liveKeys.length ? `Connected · key created ${keyDay(liveKeys[0].createdAt)}` : "No website key yet"}
      </span>
      <div className={styles.buttons}>
        {manages && b.isActive && !active && (
          <button type="button" className={ui.primary} disabled={pending} onClick={open}>Open</button>
        )}
        <button type="button" className={ui.secondary} aria-expanded={panel === "managers"} onClick={() => setPanel(panel === "managers" ? null : "managers")}>
          {panel === "managers" ? "Done" : "Edit managers"}
        </button>
        <button type="button" className={ui.secondary} aria-expanded={panel === "keys"} onClick={() => setPanel(panel === "keys" ? null : "keys")}>
          {panel === "keys" ? "Done" : "API keys"}
        </button>
        <button type="button" className={ui.secondary} disabled={pending} onClick={toggleActive}>
          {b.isActive ? "Switch off" : "Switch on"}
        </button>
      </div>
      {msg && <p className={msg.ok ? ui.success : ui.error} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {panel === "managers" && <Managers b={b} ownerId={ownerId} />}
      {panel === "keys" && <ApiKeys businessId={b.id} businessName={b.name} keys={b.keys} />}
    </li>
  );
}

function Managers({ b, ownerId }: { b: BusinessCard; ownerId: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [password, setPassword] = useState<{ email: string; password: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const r = await addManagerAction(b.id, email, name);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setMsg({ ok: true, text: `${r.data.name} can now manage ${b.name}.` });
      setPassword(r.data.tempPassword ? { email: email.trim().toLowerCase(), password: r.data.tempPassword } : null);
      setEmail(""); setName("");
    });
  };
  const remove = (userId: string, who: string) =>
    startTransition(async () => {
      const r = await removeManagerAction(b.id, userId);
      setConfirm(null);
      setMsg(r.ok ? { ok: true, text: `${who} no longer manages ${b.name}.` } : { ok: false, text: r.message });
    });

  return (
    <div className={styles.subPanel}>
      {b.managers.length > 0 && (
        <ul className={ui.lines}>
          {b.managers.map((m) => (
            <li key={m.id} className={styles.mgrRow}>
              <span><b>{m.id === ownerId ? `${m.name} (you)` : m.name}</b>{m.email && m.email !== m.name && <span className={styles.muted}> · {m.email}</span>}</span>
              {confirm === m.id ? (
                <span className={styles.buttons}>
                  <button type="button" className={styles.danger} disabled={pending} onClick={() => remove(m.id, m.name)}>Yes, remove</button>
                  <button type="button" className={ui.secondary} onClick={() => setConfirm(null)}>Keep</button>
                </span>
              ) : (
                <button type="button" className={ui.secondary} onClick={() => setConfirm(m.id)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className={styles.addMgr} onSubmit={add} noValidate>
        <div className={ui.field}>
          <label className={ui.label} htmlFor={`mgr-email-${b.id}`}>Add a manager by email</label>
          <input id={`mgr-email-${b.id}`} type="email" className={ui.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@studzpeptides.com" autoComplete="off" />
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor={`mgr-name-${b.id}`}>Name (for a new account)</label>
          <input id={`mgr-name-${b.id}`} className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoComplete="off" />
        </div>
        <button type="submit" className={ui.primary} disabled={pending}>Add manager</button>
      </form>
      <p className={ui.hint}>If they don’t have an account yet, one is made with a temporary password for you to pass on.</p>
      {msg && <p className={msg.ok ? ui.success : ui.error} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {password && (
        <div className={styles.keyOnce} role="status">
          <b>New account for {password.email}. Give them this temporary password; it won’t be shown again.</b>
          <code className={styles.code}>{password.password}</code>
          <span className={ui.hint}>They sign in at /login with their email and this password.</span>
        </div>
      )}
    </div>
  );
}
