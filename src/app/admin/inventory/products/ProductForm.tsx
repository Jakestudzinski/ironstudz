"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ui from "../_components/ui.module.css";
import styles from "./form.module.css";
import { createProductAction, updateProductAction } from "./actions";
import {
  CATEGORIES, CATEGORY_LABEL, FORM_LABEL, FORMS_FOR_CATEGORY, MAX_PRIORITY, type Category, type PackageType,
} from "@/lib/inventory/product-meta";

type FormState = {
  /** Set for forms that already exist (edit). */
  id?: string;
  /** New forms only: whether this form is being added. Existing forms are always kept. */
  enabled: boolean;
  sku: string;
  homeLocationId: string;
  minLevel: string;
  isActive: boolean;
};

export type ProductFormProps = {
  locations: { id: string; name: string }[];
  priorityCount: number;
  product?: {
    id: string;
    name: string;
    strengthSize: string | null;
    category: Category;
    vialWeightG: number | null;
    variants: { id: string; packageType: PackageType; sku: string; homeLocationId: string | null; minLevel: number; isActive: boolean }[];
  };
};

const DEFAULT_HOME: Record<PackageType, string> = { kit: "Back 1", half_kit: "Back 1", vial: "Rack A", unit: "" };

export function ProductForm({ locations, priorityCount, product }: ProductFormProps) {
  const router = useRouter();
  const editing = !!product;
  const homeId = (t: PackageType) => locations.find((l) => l.name === DEFAULT_HOME[t])?.id ?? "";

  const [name, setName] = useState(product?.name ?? "");
  const [strength, setStrength] = useState(product?.strengthSize ?? "");
  const [category, setCategory] = useState<Category>(product?.category ?? "peptide");
  const [vialWeight, setVialWeight] = useState(product?.vialWeightG?.toString() ?? "");
  const [isPriority, setIsPriority] = useState(false);
  const [forms, setForms] = useState<Partial<Record<PackageType, FormState>>>(() => {
    const out: Partial<Record<PackageType, FormState>> = {};
    for (const v of product?.variants ?? []) {
      out[v.packageType] = {
        id: v.id, enabled: true, sku: v.sku, homeLocationId: v.homeLocationId ?? "", minLevel: String(v.minLevel), isActive: v.isActive,
      };
    }
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const formFor = (t: PackageType): FormState =>
    forms[t] ?? { enabled: !editing, sku: "", homeLocationId: homeId(t), minLevel: "0", isActive: true };
  const patch = (t: PackageType, p: Partial<FormState>) => setForms((f) => ({ ...f, [t]: { ...formFor(t), ...p } }));

  // Existing forms always show; on a new product, the forms for the chosen category.
  const shown: PackageType[] = [...new Set([
    ...(product?.variants.map((v) => v.packageType) ?? []),
    ...FORMS_FOR_CATEGORY[category],
  ])];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const weight = vialWeight.trim();
    if (weight && !/^\d{1,5}(\.\d{1,3})?$/.test(weight)) return setError("Vial weight must be grams, e.g. 5.25");
    const chosen = shown.map((t) => [t, formFor(t)] as const).filter(([, f]) => f.id || f.enabled);
    for (const [t, f] of chosen) {
      if (!/^\d{1,6}$/.test(f.minLevel.trim())) return setError(`${FORM_LABEL[t]}: min level must be a whole number`);
    }
    const toVariant = ([t, f]: readonly [PackageType, FormState]) => ({
      packageType: t, sku: f.sku.trim(), homeLocationId: f.homeLocationId || null, minLevel: Number(f.minLevel.trim()),
    });
    const fields = {
      name, strengthSize: strength, category,
      vialWeightG: category === "peptide" && weight ? Number(weight) : null,
    };

    startTransition(async () => {
      if (!editing) {
        const r = await createProductAction({ ...fields, isPriority, variants: chosen.map(toVariant) });
        if (!r.ok) return setError(r.message);
        router.push(`/admin/inventory/products/${r.data}`);
      } else {
        const r = await updateProductAction({
          productId: product.id,
          fields,
          variants: chosen.filter(([, f]) => f.id).map(([t, f]) => ({ ...toVariant([t, f]), id: f.id, isActive: f.isActive })),
          newVariants: chosen.filter(([, f]) => !f.id).map(toVariant),
        });
        if (!r.ok) return setError(r.message);
        router.push(`/admin/inventory/products/${product.id}`);
      }
    });
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <section className={ui.panel} aria-labelledby="pf-details">
        <h2 id="pf-details" className={ui.panelTitle}>Product</h2>
        <div className={styles.grid}>
          <div className={`${ui.field} ${styles.wide}`}>
            <label className={ui.label} htmlFor="pf-name">Name</label>
            <input id="pf-name" className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BPC-157" autoComplete="off" />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="pf-strength">Strength or size</label>
            <input id="pf-strength" className={ui.input} value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 10mg or 30ml" autoComplete="off" />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="pf-category">Category</label>
            <select id="pf-category" className={ui.select} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          {category === "peptide" && (
            <div className={ui.field}>
              <label className={ui.label} htmlFor="pf-weight">Weight of one vial (optional)</label>
              <div className={ui.unitField}>
                <input id="pf-weight" inputMode="decimal" className={ui.input} value={vialWeight} onChange={(e) => setVialWeight(e.target.value)} placeholder="e.g. 5.25" autoComplete="off" />
                <span className={ui.unit} aria-hidden="true">g</span>
              </div>
            </div>
          )}
        </div>
        {!editing && (
          <label className={ui.check}>
            <input type="checkbox" checked={isPriority} onChange={(e) => setIsPriority(e.target.checked)} disabled={priorityCount >= MAX_PRIORITY} />
            Priority product (90-day alert)
            {priorityCount >= MAX_PRIORITY && <span className={ui.hint}>· all {MAX_PRIORITY} slots are used</span>}
          </label>
        )}
      </section>

      <section className={ui.panel} aria-labelledby="pf-forms">
        <div className={ui.panelHead}>
          <h2 id="pf-forms" className={ui.panelTitle}>Forms and website SKUs</h2>
          <p className={ui.hint}>The SKU must match exactly what the website sends with paid orders.</p>
        </div>
        <ul className={ui.lines}>
          {shown.map((t) => {
            const f = formFor(t);
            const existing = !!f.id;
            const on = existing || f.enabled;
            return (
              <li key={t} className={styles.formRow}>
                {existing ? (
                  <div className={styles.formHead}>
                    <b>{FORM_LABEL[t]}</b>
                    <label className={ui.check}>
                      <input type="checkbox" checked={f.isActive} onChange={(e) => patch(t, { isActive: e.target.checked })} />
                      Active
                    </label>
                  </div>
                ) : (
                  <label className={`${ui.check} ${styles.formHead}`}>
                    <input type="checkbox" checked={f.enabled} onChange={(e) => patch(t, { enabled: e.target.checked })} />
                    <b>{editing ? `Add ${FORM_LABEL[t]}` : `Sold as ${FORM_LABEL[t]}`}</b>
                  </label>
                )}
                {on && (
                  <div className={styles.formFields}>
                    <div className={ui.field}>
                      <label className={ui.label} htmlFor={`pf-sku-${t}`}>Website SKU</label>
                      <input id={`pf-sku-${t}`} className={`${ui.input} ${ui.mono}`} value={f.sku} onChange={(e) => patch(t, { sku: e.target.value })} autoComplete="off" autoCapitalize="characters" />
                    </div>
                    <div className={ui.field}>
                      <label className={ui.label} htmlFor={`pf-home-${t}`}>Home location</label>
                      <select id={`pf-home-${t}`} className={ui.select} value={f.homeLocationId} onChange={(e) => patch(t, { homeLocationId: e.target.value })}>
                        <option value="">None</option>
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </div>
                    <div className={ui.field}>
                      <label className={ui.label} htmlFor={`pf-min-${t}`}>Min level</label>
                      <input id={`pf-min-${t}`} inputMode="numeric" className={`${ui.input} ${ui.mono}`} value={f.minLevel} onChange={(e) => patch(t, { minLevel: e.target.value })} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {error && <p className={ui.error} role="alert">{error}</p>}

      <div className={ui.actions}>
        <button type="submit" className={ui.primary} disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add product"}
        </button>
        <Link href={editing ? `/admin/inventory/products/${product.id}` : "/admin/inventory/products"} className={ui.secondary}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
