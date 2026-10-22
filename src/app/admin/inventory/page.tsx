import styles from "./page.module.css";
import { requireManager } from "@/lib/inventory/context";
import { getSummaryCounts } from "@/lib/inventory/summary";

export default async function InventoryDashboard() {
  const { business } = await requireManager();
  const c = await getSummaryCounts(business.id);

  const cards = [
    { label: "Active products", value: c.activeProducts },
    { label: "Priority products", value: c.priorityProducts },
    { label: "Lots in testing", value: c.lotsInTesting },
    { label: "Sellable units (vial equivalents)", value: c.sellableUnits.toLocaleString("en-US") },
  ];

  return (
    <>
      <div>
        <h1 className={styles.heading}>{business.name}</h1>
        <p className={styles.sub}>Inventory overview</p>
      </div>
      <section aria-label="Summary" className={styles.cards}>
        {cards.map((card) => (
          <div key={card.label} className={styles.card}>
            <span className={styles.value}>{card.value}</span>
            <span className={styles.label}>{card.label}</span>
          </div>
        ))}
      </section>
      <p className={styles.note}>Alerts, quick actions and the priority products table are added in Phase 5.</p>
    </>
  );
}
