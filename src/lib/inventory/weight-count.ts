// Weight → vials maths. No database access, so screens can use it in the browser too.

/** More than this far from a whole vial (in vials) and the count should be redone. */
export const RECOUNT_THRESHOLD = 1 / 3;

export type WeightCount = {
  /** Rounded to the nearest whole vial. */
  vials: number;
  /** weight ÷ vial weight before rounding, e.g. 10.4 */
  exact: number;
  /** True when `exact` is more than RECOUNT_THRESHOLD away from a whole vial. */
  recount: boolean;
};

/**
 * Turns a weight on a zeroed scale into a number of vials.
 * Returns null when either weight is missing or not a usable number.
 */
export function vialsFromWeight(weightG: number, vialWeightG: number): WeightCount | null {
  if (!Number.isFinite(weightG) || !Number.isFinite(vialWeightG) || weightG < 0 || vialWeightG <= 0) return null;
  const exact = weightG / vialWeightG;
  const vials = Math.round(exact);
  // Small tolerance so 10.3333… from rounding error isn't flagged as over a third.
  const recount = Math.abs(exact - vials) > RECOUNT_THRESHOLD + 1e-9;
  return { vials, exact: Math.round(exact * 100) / 100, recount };
}
