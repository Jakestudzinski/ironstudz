// Adjustment reasons and lot statuses. No database access, so screens can use them in the browser too.

export const ADJUST_REASONS = ["count_correction", "damaged", "failed_testing", "order_cancelled", "other"] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];
export const REASON_LABEL: Record<AdjustReason, string> = {
  count_correction: "Count correction",
  damaged: "Damaged",
  failed_testing: "Failed testing",
  order_cancelled: "Order cancelled",
  other: "Other",
};

export const LOT_STATUSES = ["in_testing", "passed", "failed"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];
