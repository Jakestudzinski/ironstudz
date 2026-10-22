"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ui from "../_components/ui.module.css";
import styles from "./count.module.css";
import { startCountAction } from "../stock-actions";

export function StartCount({ locations, openAt }: { locations: { id: string; name: string }[]; openAt: string[] }) {
  const router = useRouter();
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!locationId) return setError("Choose the location to count");
    startTransition(async () => {
      const r = await startCountAction(locationId);
      if (!r.ok) return setError(r.message);
      router.push(`/admin/inventory/count/${r.data.countId}`);
    });
  };

  return (
    <form className={ui.panel} onSubmit={start} aria-labelledby="ct-start">
      <h2 id="ct-start" className={ui.panelTitle}>Start a count</h2>
      <div className={styles.startRow}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="ct-location">Location</label>
          <select id="ct-location" className={ui.select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Choose…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}{openAt.includes(l.name) ? " (count in progress)" : ""}</option>
            ))}
          </select>
        </div>
        <button type="submit" className={ui.primary} disabled={pending}>{pending ? "Starting…" : "Start count"}</button>
      </div>
      {error && <p className={ui.error} role="alert">{error}</p>}
    </form>
  );
}
