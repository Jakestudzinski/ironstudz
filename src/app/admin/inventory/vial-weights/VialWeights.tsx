"use client";

import { useActionState, useMemo, useState } from "react";
import styles from "./page.module.css";
import { saveVialWeight, type SaveState } from "./actions";
import { vialsFromWeight } from "@/lib/inventory/weight-count";
import type { VialWeightRow } from "@/lib/inventory/weights";

const CATEGORY: Record<string, string> = { peptide: "Peptide", skin_care: "Skin care", pre_workout: "Pre-workout" };

const productLabel = (p: VialWeightRow) => (p.strengthSize ? `${p.name} ${p.strengthSize}` : p.name);

export function VialWeights({ products, missing }: { products: VialWeightRow[]; missing: number }) {
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? products.filter((p) => productLabel(p).toLowerCase().includes(s)) : products;
  }, [products, search]);

  return (
    <>
      <WeightChecker products={products} />

      <section className={styles.panel} aria-labelledby="vw-list">
        <div className={styles.panelHead}>
          <h2 id="vw-list" className={styles.panelTitle}>All products</h2>
          <span className={missing ? styles.pillWarn : styles.pillOk}>
            {missing ? `${missing} not set` : "All set"}
          </span>
        </div>
        <label className={styles.searchLabel} htmlFor="vw-search">Search products</label>
        <input
          id="vw-search"
          type="search"
          className={styles.input}
          placeholder="Name or strength"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className={styles.rows}>
          {shown.map((p) => (
            <WeightRow key={p.id} product={p} />
          ))}
          {shown.length === 0 && <li className={styles.none}>No products match “{search}”.</li>}
        </ul>
      </section>
    </>
  );
}

function WeightRow({ product }: { product: VialWeightRow }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveVialWeight, null);
  const inputId = `vw-${product.id}`;

  return (
    <li className={styles.row}>
      <div className={styles.rowName}>
        <span className={styles.name}>{productLabel(product)}</span>
        <span className={styles.meta}>
          {CATEGORY[product.category] ?? product.category}
          {product.vialWeightG === null && <span className={styles.pillWarn}>Not set</span>}
        </span>
      </div>
      <form action={action} className={styles.rowForm}>
        <input type="hidden" name="productId" value={product.id} />
        <label htmlFor={inputId} className={styles.visuallyHidden}>
          Weight of one vial of {productLabel(product)}, in grams
        </label>
        <div className={styles.unitField}>
          <input
            id={inputId}
            name="weight"
            inputMode="decimal"
            autoComplete="off"
            className={styles.input}
            defaultValue={product.vialWeightG ?? ""}
            placeholder="e.g. 5.2"
          />
          <span className={styles.unit} aria-hidden="true">g</span>
        </div>
        <button type="submit" className={styles.save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <span role="status" className={state?.ok === false ? styles.error : styles.saved}>
          {state?.message ?? ""}
        </span>
      </form>
    </li>
  );
}

/** Try a weight against a product's vial weight. Becomes part of the Stock count screen later. */
function WeightChecker({ products }: { products: VialWeightRow[] }) {
  const ready = products.filter((p) => p.vialWeightG !== null);
  const [productId, setProductId] = useState(ready[0]?.id ?? "");
  const [weight, setWeight] = useState("");
  const product = ready.find((p) => p.id === productId);
  const result = product && weight.trim() !== "" ? vialsFromWeight(Number(weight), product.vialWeightG!) : null;

  return (
    <section className={styles.panel} aria-labelledby="vw-check">
      <h2 id="vw-check" className={styles.panelTitle}>Check a weight</h2>
      {ready.length === 0 ? (
        <p className={styles.hint}>Set a vial weight below to try it out.</p>
      ) : (
        <div className={styles.checker}>
          <div className={styles.field}>
            <label htmlFor="vw-check-product">Product</label>
            <select id="vw-check-product" className={styles.input} value={productId} onChange={(e) => setProductId(e.target.value)}>
              {ready.map((p) => (
                <option key={p.id} value={p.id}>{productLabel(p)} ({p.vialWeightG} g)</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="vw-check-weight">Weight on scale</label>
            <div className={styles.unitField}>
              <input
                id="vw-check-weight"
                inputMode="decimal"
                autoComplete="off"
                className={styles.input}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="e.g. 52.4"
              />
              <span className={styles.unit} aria-hidden="true">g</span>
            </div>
          </div>
          <div className={styles.result} aria-live="polite">
            {result ? (
              <>
                <span className={styles.resultValue}>{result.vials} vials</span>
                {result.recount ? (
                  <span className={styles.pillWarn}>Recount: works out to {result.exact} vials</span>
                ) : (
                  <span className={styles.pillOk}>OK · {result.exact} vials</span>
                )}
              </>
            ) : (
              <span className={styles.hint}>
                {weight.trim() === "" ? "Enter a weight to see the vial count." : "Enter grams, e.g. 52.4"}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
