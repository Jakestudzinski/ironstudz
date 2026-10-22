import styles from "./page.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listVialWeights } from "@/lib/inventory/weights";
import { VialWeights } from "./VialWeights";

export const metadata = { title: "Vial weights · Inventory" };

export default async function VialWeightsPage() {
  const { business } = await requireManager();
  const products = await listVialWeights(business.id);
  const missing = products.filter((p) => p.vialWeightG === null).length;

  return (
    <>
      <div>
        <h1 className={styles.heading}>Vial weights</h1>
        <p className={styles.sub}>
          The weight of one vial for each product, used to count by weight. Zero the scale first.
        </p>
      </div>
      {products.length === 0 ? (
        <p className={styles.empty}>No products yet. Products added to {business.name} will appear here.</p>
      ) : (
        <VialWeights products={products} missing={missing} />
      )}
    </>
  );
}
