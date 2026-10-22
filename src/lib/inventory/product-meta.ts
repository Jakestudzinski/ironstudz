// Product categories, forms and display helpers. No database access, so screens can use it in the browser too.

export const CATEGORIES = ["peptide", "skin_care", "pre_workout"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PACKAGE_TYPES = ["kit", "half_kit", "vial", "unit"] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  peptide: "Peptide",
  skin_care: "Skin care",
  pre_workout: "Pre-workout",
};

export const UNITS_PER_PACKAGE: Record<PackageType, number> = { kit: 10, half_kit: 5, vial: 1, unit: 1 };

/** Which forms each category can be sold in. Peptides come as kits, half kits and vials; the rest as single units. */
export const FORMS_FOR_CATEGORY: Record<Category, PackageType[]> = {
  peptide: ["kit", "half_kit", "vial"],
  skin_care: ["unit"],
  pre_workout: ["unit"],
};

export const FORM_LABEL: Record<PackageType, string> = {
  kit: "Kit (10 vials)",
  half_kit: "Half kit (5 vials)",
  vial: "Vial",
  unit: "Unit",
};

const FORM_SHORT: Record<PackageType, [string, string]> = {
  kit: ["kit", "kits"],
  half_kit: ["half", "half"],
  vial: ["vial", "vials"],
  unit: ["unit", "units"],
};

/** Highest number of priority products (90-day alert) per business. */
export const MAX_PRIORITY = 15;
/** Below this many days of cover a product is "Reorder"; between this and cover_days it's "Watch". */
export const REORDER_DAYS = 60;

export type FormCounts = Partial<Record<PackageType, number>>;

export const productLabel = (p: { name: string; strengthSize: string | null }) =>
  p.strengthSize ? `${p.name} ${p.strengthSize}` : p.name;

/** "48 kits · 6 half · 30 vials" for the forms a product has (in kit, half, vial order) or "85 units". */
export function formatMix(counts: FormCounts, forms: PackageType[]): string {
  const ordered = PACKAGE_TYPES.filter((t) => forms.includes(t));
  if (ordered.length === 0) return "No forms yet";
  return ordered.map((t) => `${counts[t] ?? 0} ${FORM_SHORT[t][(counts[t] ?? 0) === 1 ? 0 : 1]}`).join(" · ");
}

/** "+30 kits" style summary of stock in testing, or null when there is none. */
export function formatInTesting(counts: FormCounts): string | null {
  const parts = PACKAGE_TYPES.filter((t) => (counts[t] ?? 0) > 0).map(
    (t) => `${counts[t]} ${FORM_SHORT[t][counts[t] === 1 ? 0 : 1]}`
  );
  return parts.length ? "+" + parts.join(" · ") : null;
}

export type CoverStatus = "ok" | "watch" | "reorder" | "no_sales";

export const STATUS_LABEL: Record<CoverStatus, string> = {
  ok: "OK",
  watch: "Watch",
  reorder: "Reorder",
  no_sales: "No sales",
};

export function coverStatus(daysOfCover: number | null, coverDays: number): CoverStatus {
  if (daysOfCover === null) return "no_sales";
  if (daysOfCover >= coverDays) return "ok";
  if (daysOfCover >= REORDER_DAYS) return "watch";
  return "reorder";
}

/** Shows a UTC time as Phoenix local time, e.g. "Oct 22, 9:42 AM". */
export function formatPhoenix(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
