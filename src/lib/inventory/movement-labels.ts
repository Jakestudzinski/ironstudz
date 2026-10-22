// Movement types. No database access, so screens can use them in the browser too.

export const MOVEMENT_TYPES = ["received", "sold", "break_down", "transfer", "adjustment"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const TYPE_LABEL: Record<MovementType, string> = {
  received: "Received", sold: "Sold", break_down: "Break down", transfer: "Moved", adjustment: "Adjustment",
};
