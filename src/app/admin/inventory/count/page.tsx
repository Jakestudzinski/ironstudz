import Link from "next/link";
import ui from "../_components/ui.module.css";
import styles from "./count.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listCounts } from "@/lib/inventory/counts";
import { listLocations } from "@/lib/inventory/products";
import { formatPhoenix } from "@/lib/inventory/product-meta";
import { StartCount } from "./StartCount";

export const metadata = { title: "Stock count · Inventory" };

const STATUS = { open: ["In progress", ui.in_testing], finished: ["Finished", ui.passed], cancelled: ["Cancelled", ui.neutral] } as const;

export default async function CountsPage() {
  const { business } = await requireManager();
  const [counts, locations] = await Promise.all([listCounts(business.id), listLocations()]);
  const open = counts.filter((c) => c.status === "open");
  const past = counts.filter((c) => c.status !== "open");

  return (
    <>
      <div>
        <h1 className={ui.heading}>Stock count</h1>
        <p className={ui.sub}>
          Count one location at a time. Enter what’s on the shelf, by number or (for loose vials) by weight. Finishing
          corrects the stock and records every difference.
        </p>
      </div>

      <StartCount locations={locations} openAt={open.map((c) => c.location)} />

      {open.length > 0 && (
        <section className={ui.panel} aria-labelledby="ct-open">
          <h2 id="ct-open" className={ui.panelTitle}>Counts in progress</h2>
          <ul className={ui.lines}>
            {open.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/inventory/count/${c.id}`} className={styles.countLink}>
                  <span><b>{c.location}</b> · {c.counted} of {c.lines} lines counted</span>
                  <span className={styles.muted}>Started {formatPhoenix(c.startedAt)} by {c.startedBy} · Continue →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={ui.panel} aria-labelledby="ct-past">
        <h2 id="ct-past" className={ui.panelTitle}>Recent counts</h2>
        {past.length === 0 ? (
          <p className={ui.empty}>No finished counts in the last 60 days.</p>
        ) : (
          <ul className={ui.lines}>
            {past.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/inventory/count/${c.id}`} className={styles.countLink}>
                  <span>
                    <b>{c.location}</b> <span className={`${ui.pill} ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>
                  </span>
                  <span className={styles.muted}>
                    {formatPhoenix(c.finishedAt ?? c.startedAt)} · {c.counted} of {c.lines} counted
                    {c.status === "finished" ? ` · ${c.differences} ${c.differences === 1 ? "difference" : "differences"}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
