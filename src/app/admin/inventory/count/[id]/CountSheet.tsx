"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ui from "../../_components/ui.module.css";
import styles from "../count.module.css";
import { addCountLineAction, cancelCountAction, finishCountAction, saveCountLineAction } from "../../stock-actions";
import { vialsFromWeight } from "@/lib/inventory/weight-count";
import type { CountLine } from "@/lib/inventory/counts";
import type { VariantOption } from "@/lib/inventory/stock-reads";

const FORM = { kit: "Kit", half_kit: "Half kit", vial: "Vial", unit: "Unit" } as const;
const STATUS = { passed: ["Passed", ui.passed], in_testing: ["In testing", ui.in_testing], failed: ["Failed", ui.failed] } as const;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

type Count = { id: string; status: "open" | "finished" | "cancelled"; location: string; lines: CountLine[] };
type Lot = { id: string; productId: string; lotNumber: string };
type Msg = { ok: boolean; text: string } | null;

export function CountSheet({ count, variants, lots }: { count: Count; variants: VariantOption[]; lots: Lot[] }) {
  const open = count.status === "open";
  const [reviewing, setReviewing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const counted = count.lines.filter((l) => l.counted !== null);
  // Compared with the stock right now, which is what Finish uses.
  const differences = counted.filter((l) => l.counted !== l.current);
  const moved = count.lines.filter((l) => l.current !== l.expected);

  const finish = () =>
    startTransition(async () => {
      const r = await finishCountAction(count.id);
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setReviewing(false);
      setMessage({
        ok: true,
        text: `Count finished: ${r.data.corrections} ${r.data.corrections === 1 ? "correction" : "corrections"} made` +
          `${r.data.skipped ? `, ${r.data.skipped} blank ${r.data.skipped === 1 ? "line" : "lines"} skipped` : ""}.`,
      });
      router.refresh();
    });

  const cancel = () =>
    startTransition(async () => {
      const r = await cancelCountAction(count.id);
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      router.push("/admin/inventory/count");
    });

  if (!open) {
    return (
      <>
        {message && <p className={message.ok ? ui.success : ui.error} role="status">{message.text}</p>}
        <section className={ui.panel} aria-label="Count results">
          {count.lines.length === 0 ? (
            <p className={ui.empty}>Nothing was on this shelf.</p>
          ) : (
            <ul className={ui.lines}>
              {count.lines.map((l) => {
                const diff = l.counted === null ? null : l.counted - l.expected;
                return (
                  <li key={l.id} className={styles.resultRow}>
                    <div className={styles.lineInfo}>
                      <b>{l.product} · {FORM[l.packageType]}</b>
                      <span className={styles.muted}>Lot {l.lotNumber} · {l.sku}</span>
                    </div>
                    <span className={styles.figures}>
                      {l.counted === null ? "Not counted" : `System ${l.expected} · counted ${l.counted}`}
                      {l.countedWeightG !== null && ` (${l.countedWeightG} g)`}
                    </span>
                    {diff !== null && (
                      <span className={`${ui.pill} ${diff === 0 ? ui.ok : ui.watch}`}>{diff === 0 ? "Matched" : signed(diff)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <div className={styles.progress} role="status">
        <b>{counted.length} of {count.lines.length}</b> lines counted · {differences.length}{" "}
        {differences.length === 1 ? "difference" : "differences"} so far
      </div>

      {moved.length > 0 && (
        <p className={ui.error}>
          Stock changed on {moved.length} {moved.length === 1 ? "line" : "lines"} since this count started (e.g. an order was
          packed). Those lines show the number now. Recheck them before finishing.
        </p>
      )}

      <section className={ui.panel} aria-label={`Lines at ${count.location}`}>
        {count.lines.length === 0 ? (
          <p className={ui.empty}>The system has nothing at {count.location}. Add anything you find below.</p>
        ) : (
          <ul className={ui.lines}>
            {count.lines.map((l) => <CountRow key={l.id} countId={count.id} line={l} />)}
          </ul>
        )}
      </section>

      <AddFound countId={count.id} variants={variants} lots={lots} />

      {message && <p className={message.ok ? ui.success : ui.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}

      {reviewing ? (
        <section className={ui.panel} aria-labelledby="ct-review">
          <h2 id="ct-review" className={ui.panelTitle}>Check before finishing</h2>
          {differences.length === 0 ? (
            <p className={ui.hint}>Everything counted matches the system. Finishing records the count; no stock changes.</p>
          ) : (
            <ul className={ui.lines}>
              {differences.map((l) => (
                <li key={l.id} className={styles.resultRow}>
                  <div className={styles.lineInfo}>
                    <b>{l.product} · {FORM[l.packageType]}</b>
                    <span className={styles.muted}>Lot {l.lotNumber}</span>
                  </div>
                  <span className={styles.figures}>System {l.current} → counted {l.counted}</span>
                  <span className={`${ui.pill} ${ui.watch}`}>{signed(l.counted! - l.current)}</span>
                </li>
              ))}
            </ul>
          )}
          {count.lines.length - counted.length > 0 && (
            <p className={ui.hint}>
              {count.lines.length - counted.length} blank {count.lines.length - counted.length === 1 ? "line is" : "lines are"} skipped and left as they are.
            </p>
          )}
          <div className={ui.actions}>
            <button type="button" className={ui.primary} disabled={pending} onClick={finish}>
              {pending ? "Finishing…" : differences.length ? `Finish and correct ${differences.length}` : "Finish count"}
            </button>
            <button type="button" className={ui.secondary} disabled={pending} onClick={() => setReviewing(false)}>Keep counting</button>
          </div>
        </section>
      ) : (
        <div className={ui.actions}>
          <button type="button" className={ui.primary} disabled={pending || counted.length === 0} onClick={() => { setReviewing(true); setMessage(null); }}>
            Review and finish
          </button>
          {!confirmCancel ? (
            <button type="button" className={ui.secondary} disabled={pending} onClick={() => setConfirmCancel(true)}>Cancel count</button>
          ) : (
            <>
              <button type="button" className={styles.danger} disabled={pending} onClick={cancel}>Yes, cancel. Change nothing</button>
              <button type="button" className={ui.secondary} disabled={pending} onClick={() => setConfirmCancel(false)}>Keep it</button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** One line: what the system expects, and a box for what's there (a number, or grams for loose vials). Saves on leaving the box. */
function CountRow({ countId, line }: { countId: string; line: CountLine }) {
  const canWeigh = line.packageType === "vial" && line.vialWeightG !== null;
  const [mode, setMode] = useState<"number" | "weight">(line.countedWeightG !== null ? "weight" : "number");
  const [value, setValue] = useState(
    line.countedWeightG !== null ? String(line.countedWeightG) : line.counted !== null ? String(line.counted) : ""
  );
  const [saved, setSaved] = useState(value);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const id = `cl-${line.id}`;

  const trimmed = value.trim();
  const preview = mode === "weight" && trimmed && canWeigh ? vialsFromWeight(Number(trimmed), line.vialWeightG!) : null;
  const shown = mode === "weight" ? preview?.vials ?? null : /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const diff = shown === null ? null : shown - line.current;

  const save = () => {
    if (trimmed === saved.trim()) return;
    let counted: number | null = null;
    let weightG: number | null = null;
    if (trimmed !== "") {
      if (mode === "weight") {
        if (!/^\d{1,6}(\.\d{1,3})?$/.test(trimmed)) return setMsg({ ok: false, text: "Enter grams, e.g. 52.4" });
        weightG = Number(trimmed);
      } else {
        if (!/^\d{1,6}$/.test(trimmed)) return setMsg({ ok: false, text: "Whole number, 0 or more" });
        counted = Number(trimmed);
      }
    }
    startTransition(async () => {
      const r = await saveCountLineAction(countId, line.id, counted, weightG);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setSaved(trimmed);
      setMsg({ ok: true, text: trimmed === "" ? "Cleared" : "Saved" });
    });
  };

  const [statusLabel, statusClass] = STATUS[line.testingStatus];
  return (
    <li className={styles.countRow}>
      <div className={styles.lineInfo}>
        <b>{line.product} · {FORM[line.packageType]}</b>
        <span className={styles.muted}>
          Lot {line.lotNumber} · {line.sku} <span className={`${ui.pill} ${statusClass}`}>{statusLabel}</span>
        </span>
        <span className={styles.expected}>
          System has <b>{line.current}</b>
          {line.current !== line.expected && <span className={styles.changed}> (was {line.expected} when the count started)</span>}
        </span>
      </div>

      <div className={styles.entry}>
        {canWeigh && (
          <div className={styles.modeSwitch} role="group" aria-label="Count by">
            <button type="button" aria-pressed={mode === "number"} onClick={() => { setMode("number"); setValue(""); setMsg(null); }}>Number</button>
            <button type="button" aria-pressed={mode === "weight"} onClick={() => { setMode("weight"); setValue(""); setMsg(null); }}>Weight</button>
          </div>
        )}
        <label htmlFor={id} className={ui.visuallyHidden}>
          {mode === "weight" ? `Weight in grams of ${line.product} lot ${line.lotNumber}` : `Count of ${line.product} ${FORM[line.packageType]} lot ${line.lotNumber}`}
        </label>
        <div className={ui.unitField}>
          <input
            id={id}
            inputMode={mode === "weight" ? "decimal" : "numeric"}
            className={`${ui.input} ${ui.mono}`}
            value={value}
            placeholder={mode === "weight" ? "grams" : "count"}
            disabled={pending}
            aria-invalid={msg?.ok === false}
            onChange={(e) => { setValue(e.target.value); setMsg(null); }}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          />
          {mode === "weight" && <span className={ui.unit} aria-hidden="true">g</span>}
        </div>
        <div className={styles.result} aria-live="polite">
          {mode === "weight" && preview && (
            <span className={preview.recount ? ui.inlineError : undefined}>
              = {preview.vials} vials{preview.recount ? ` (works out to ${preview.exact}: recount)` : ""}
            </span>
          )}
          {diff !== null && <span className={`${ui.pill} ${diff === 0 ? ui.ok : ui.watch}`}>{diff === 0 ? "Matches" : signed(diff)}</span>}
          {msg && <span className={msg.ok ? ui.inlineOk : ui.inlineError}>{msg.text}</span>}
        </div>
      </div>
    </li>
  );
}

/** Stock on the shelf that the system didn't list here. */
function AddFound({ countId, variants, lots }: { countId: string; variants: VariantOption[]; lots: Lot[] }) {
  const [open, setOpen] = useState(false);
  const [variantId, setVariantId] = useState("");
  const [lotId, setLotId] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const variant = variants.find((v) => v.id === variantId);
  const productLots = variant ? lots.filter((l) => l.productId === variant.productId) : [];

  if (!open) {
    return (
      <button type="button" className={`${ui.secondary} ${styles.addFound}`} onClick={() => setOpen(true)}>
        Found something not on the list?
      </button>
    );
  }
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantId || !lotId) return setMsg({ ok: false, text: "Choose the form and its lot" });
    startTransition(async () => {
      const r = await addCountLineAction(countId, variantId, lotId);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setMsg({ ok: true, text: "Added to the list. Enter its count above." });
      setVariantId(""); setLotId("");
      router.refresh();
    });
  };
  return (
    <form className={ui.panel} onSubmit={add} aria-labelledby="ct-found">
      <h2 id="ct-found" className={ui.panelTitle}>Add something found on the shelf</h2>
      <div className={styles.foundGrid}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="ct-found-variant">Product and form</label>
          <select id="ct-found-variant" className={ui.select} value={variantId} onChange={(e) => { setVariantId(e.target.value); setLotId(""); }}>
            <option value="">Choose…</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="ct-found-lot">Lot</label>
          <select id="ct-found-lot" className={ui.select} value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={!variant}>
            <option value="">{variant ? (productLots.length ? "Choose…" : "No lots: use Receive stock") : "Choose a product first"}</option>
            {productLots.map((l) => <option key={l.id} value={l.id}>Lot {l.lotNumber}</option>)}
          </select>
        </div>
      </div>
      {msg && <p className={msg.ok ? ui.success : ui.error} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      <div className={ui.actions}>
        <button type="submit" className={ui.primary} disabled={pending}>Add to count</button>
        <button type="button" className={ui.secondary} onClick={() => { setOpen(false); setMsg(null); }}>Close</button>
      </div>
    </form>
  );
}
