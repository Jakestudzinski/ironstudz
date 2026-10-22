import ui from "../_components/ui.module.css";
import { requireManager } from "@/lib/inventory/context";
import { listLots } from "@/lib/inventory/stock-reads";
import { LotsBoard } from "./LotsBoard";

export const metadata = { title: "Lots and testing · Inventory" };

const recent = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 30 * 86400000;

export default async function LotsPage() {
  const { business } = await requireManager();
  const lots = await listLots(business.id);
  const overdue = lots.inTesting.filter((l) => l.overdue).length;
  const toWriteOff = lots.failed.filter((l) => l.units > 0).length;

  return (
    <>
      <div>
        <h1 className={ui.heading}>Lots and testing</h1>
        <p className={ui.sub}>
          {lots.inTesting.length} in testing{overdue ? ` · ${overdue} overdue (over ${lots.overdueDays} days)` : ""}
          {toWriteOff ? ` · ${toWriteOff} failed with stock to write off` : ""}
        </p>
      </div>
      <LotsBoard
        lots={{
          inTesting: lots.inTesting,
          // Used-up lots drop off after 30 days, so the lists stay about what's on the shelves.
          failed: lots.failed.filter((l) => l.units > 0 || recent(l.changedAt)),
          passed: lots.passed.filter((l) => l.units > 0 || recent(l.changedAt)),
        }}
      />
    </>
  );
}
