"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import ui from "../_components/ui.module.css";
import styles from "./import.module.css";
import { applyImportAction, previewImportAction } from "./actions";
import type { ImportAction, ImportResult } from "@/lib/inventory/import";

const ACTION: Record<ImportAction, { label: string; pill: string }> = {
  new_product: { label: "New product", pill: ui.info },
  new_form: { label: "New form", pill: ui.info },
  update: { label: "Update", pill: ui.neutral },
  error: { label: "Fix this", pill: ui.failed },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ImportScreen({ template }: { template: string }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [imported, setImported] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const choose = async (file: File | undefined) => {
    setResult(null);
    setMessage(null);
    setImported(false);
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    startTransition(async () => {
      const r = await previewImportAction(text);
      if (r.ok) setResult(r.result);
      else setMessage({ ok: false, text: r.message });
    });
  };

  const doImport = () => {
    if (!csv) return;
    startTransition(async () => {
      const r = await applyImportAction(csv);
      if (r.ok) {
        setResult(r.result);
        setImported(true);
        const c = r.result.counts;
        setMessage({
          ok: true,
          text: `Imported: ${plural(c.newProducts, "new product", "new products")}, ${plural(c.newForms, "new form", "new forms")}, ${plural(c.updates, "update", "updates")}.`,
        });
      } else {
        if (r.result) setResult(r.result);
        setMessage({ ok: false, text: r.message });
      }
    });
  };

  const reset = () => {
    setFileName(null); setCsv(null); setResult(null); setMessage(null); setImported(false);
    if (input.current) input.current.value = "";
  };

  const problems = result ? result.counts.errors + result.fileErrors.length : 0;
  const templateHref = "data:text/csv;charset=utf-8," + encodeURIComponent(template);

  return (
    <>
      <section className={ui.panel} aria-labelledby="im-how">
        <h2 id="im-how" className={ui.panelTitle}>1. Fill in the template</h2>
        <p className={styles.text}>
          One row per form (kit, half kit, vial or unit) with its website SKU. Rows are matched on SKU: a SKU that already
          exists updates that form; a new SKU is added to the product with the same name and strength, or creates it.
          Blank cells leave existing values as they are.
        </p>
        <dl className={styles.columns}>
          <dt>sku, product, category, form</dt><dd>Required. Category: peptide, skin care or pre-workout. Form: kit, half kit, vial or unit.</dd>
          <dt>strength</dt><dd>e.g. 10mg or 30ml</dd>
          <dt>home_location</dt><dd>Back 1, Rack A, Rack C, D6, D3 or D2</dd>
          <dt>min_level</dt><dd>Low-stock alert level, a whole number</dd>
          <dt>priority, active</dt><dd>yes or no (up to 15 priority products)</dd>
          <dt>vial_weight_g</dt><dd>Weight of one vial in grams, for counting by weight</dd>
        </dl>
        <a href={templateHref} download="studzstock-products-template.csv" className={`${ui.secondary} ${styles.template}`}>
          Download template
        </a>
      </section>

      <section className={ui.panel} aria-labelledby="im-file">
        <h2 id="im-file" className={ui.panelTitle}>2. Choose the file</h2>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="im-input">CSV file</label>
          <input
            ref={input}
            id="im-input"
            type="file"
            accept=".csv,text/csv"
            className={`${ui.input} ${styles.file}`}
            disabled={pending}
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </div>
        {pending && !result && <p className={ui.hint} role="status">Checking {fileName}…</p>}
      </section>

      {message && <p className={message.ok ? ui.success : ui.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}

      {result && (
        <section className={ui.panel} aria-labelledby="im-preview">
          <div className={ui.panelHead}>
            <h2 id="im-preview" className={ui.panelTitle}>{imported ? "Imported" : "3. Check and import"}</h2>
            <p className={ui.hint}>{fileName}</p>
          </div>

          <div className={styles.summary}>
            <span className={`${ui.pill} ${ui.info}`}>{plural(result.counts.newProducts, "new product", "new products")}</span>
            <span className={`${ui.pill} ${ui.info}`}>{plural(result.counts.newForms, "new form", "new forms")}</span>
            <span className={`${ui.pill} ${ui.neutral}`}>{plural(result.counts.updates, "update", "updates")}</span>
            <span className={`${ui.pill} ${problems ? ui.failed : ui.ok}`}>
              {problems ? plural(problems, "problem", "problems") : "No problems"}
            </span>
          </div>

          {result.fileErrors.map((e) => <p key={e} className={ui.error}>{e}</p>)}
          {problems > 0 && !imported && (
            <p className={ui.hint}>Fix the rows marked “Fix this” in your spreadsheet, save it as CSV, and choose it again. Nothing is imported until every row is OK.</p>
          )}

          {result.rows.length > 0 && (
            <>
              <table className={`${ui.table} inv-hide-phone`}>
                <thead>
                  <tr><th className={ui.num}>Line</th><th>SKU</th><th>Product</th><th>Form</th><th>What happens</th></tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.line}>
                      <td className={ui.num}>{r.line}</td>
                      <td className={ui.mono}>{r.sku || "—"}</td>
                      <td>{r.product || "—"}</td>
                      <td>{r.form || "—"}</td>
                      <td>
                        <span className={`${ui.pill} ${ACTION[r.action].pill}`}>{ACTION[r.action].label}</span>
                        {r.errors.map((e) => <div key={e} className={ui.inlineError}>{e}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className={`${ui.lines} inv-show-phone`}>
                {result.rows.map((r) => (
                  <li key={r.line} className={styles.rowCard}>
                    <div className={styles.rowTop}>
                      <b>{r.product || "—"}</b>
                      <span className={`${ui.pill} ${ACTION[r.action].pill}`}>{ACTION[r.action].label}</span>
                    </div>
                    <div className={ui.hint}>Line {r.line} · {r.form || "—"} · <span className={ui.mono}>{r.sku || "—"}</span></div>
                    {r.errors.map((e) => <div key={e} className={ui.inlineError}>{e}</div>)}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={ui.actions}>
            {imported ? (
              <>
                <Link href="/admin/inventory/products" className={ui.primary}>Go to products</Link>
                <button type="button" className={ui.secondary} onClick={reset}>Import another file</button>
              </>
            ) : (
              <>
                <button type="button" className={ui.primary} disabled={pending || problems > 0 || result.rows.length === 0} onClick={doImport}>
                  {pending ? "Importing…" : `Import ${plural(result.rows.length, "row", "rows")}`}
                </button>
                <button type="button" className={ui.secondary} onClick={reset} disabled={pending}>Choose another file</button>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
