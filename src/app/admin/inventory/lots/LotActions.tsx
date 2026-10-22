"use client";

import { useState, useTransition } from "react";
import ui from "../_components/ui.module.css";
import styles from "./lots.module.css";
import { setLotStatusAction, writeOffLotAction } from "../stock-actions";
import type { Flash } from "./LotsBoard";

type Status = "in_testing" | "passed" | "failed";
type Lot = { id: string; lotNumber: string; product: string; status: Status; units: number; stockText: string };

const LABEL: Record<Status, string> = { in_testing: "In testing", passed: "Passed", failed: "Failed" };

/**
 * In testing: Passed / Failed buttons. Already decided: "Change result" (needs a note).
 * Failed with stock left: a write-off button that asks to confirm first.
 * Problems show next to the lot; confirmations go to the top of the page via onDone.
 */
export function LotActions({ lot, onDone }: { lot: Lot; onDone: (f: Flash) => void }) {
  const [changing, setChanging] = useState(false);
  const [to, setTo] = useState<Status>(lot.status === "passed" ? "failed" : "passed");
  const [note, setNote] = useState("");
  const [confirmWriteOff, setConfirmWriteOff] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const setStatus = (status: Status, withNote: string | null) =>
    startTransition(async () => {
      setMessage(null);
      const r = await setLotStatusAction({ lotId: lot.id, status, note: withNote ?? "" });
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setChanging(false);
      setNote("");
      const what = `${lot.product} lot ${lot.lotNumber}`;
      onDone({
        ok: true,
        text: status === "passed" ? `${what} passed. Its stock is now sellable.` :
          status === "failed" ? `${what} failed and is blocked from sale.` : `${what} is back in testing and can't be sold.`,
      });
    });

  const writeOff = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await writeOffLotAction(lot.id);
      setConfirmWriteOff(false);
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      onDone({ ok: true, text: `Wrote off ${lot.stockText} of ${lot.product} lot ${lot.lotNumber} (failed testing).` });
    });

  return (
    <div className={styles.actions}>
      {lot.status === "in_testing" ? (
        <div className={styles.buttons}>
          <button type="button" className={styles.pass} disabled={pending} onClick={() => setStatus("passed", null)}>
            Passed
          </button>
          <button type="button" className={styles.fail} disabled={pending} onClick={() => setStatus("failed", null)}>
            Failed
          </button>
        </div>
      ) : (
        <div className={styles.buttons}>
          {lot.status === "failed" && lot.units > 0 && !confirmWriteOff && (
            <button type="button" className={styles.fail} disabled={pending} onClick={() => setConfirmWriteOff(true)}>
              Write off stock
            </button>
          )}
          {!changing && (
            <button type="button" className={ui.secondary} disabled={pending} onClick={() => setChanging(true)}>
              Change result
            </button>
          )}
        </div>
      )}

      {confirmWriteOff && (
        <div className={styles.confirm} role="group" aria-label={`Write off lot ${lot.lotNumber}`}>
          <p>Remove {lot.stockText} of {lot.product} (Lot {lot.lotNumber}) from stock? Only do this once it’s been thrown out.</p>
          <div className={styles.buttons}>
            <button type="button" className={styles.failSolid} disabled={pending} onClick={writeOff}>Yes, write it off</button>
            <button type="button" className={ui.secondary} disabled={pending} onClick={() => setConfirmWriteOff(false)}>Cancel</button>
          </div>
        </div>
      )}

      {changing && (
        <form
          className={styles.change}
          onSubmit={(e) => { e.preventDefault(); setStatus(to, note); }}
          aria-label={`Change result for lot ${lot.lotNumber}`}
        >
          <div className={ui.field}>
            <label className={ui.label} htmlFor={`to-${lot.id}`}>Change to</label>
            <select id={`to-${lot.id}`} className={ui.select} value={to} onChange={(e) => setTo(e.target.value as Status)}>
              {(["passed", "failed", "in_testing"] as Status[]).filter((s) => s !== lot.status).map((s) => (
                <option key={s} value={s}>{LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor={`note-${lot.id}`}>Why? (required)</label>
            <input id={`note-${lot.id}`} className={ui.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Recall from supplier" autoComplete="off" />
          </div>
          <div className={styles.buttons}>
            <button type="submit" className={ui.primary} disabled={pending}>Save</button>
            <button type="button" className={ui.secondary} disabled={pending} onClick={() => { setChanging(false); setMessage(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {message && <span role="status" className={message.ok ? ui.inlineOk : ui.inlineError}>{message.text}</span>}
    </div>
  );
}
