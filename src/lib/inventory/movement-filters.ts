import { MOVEMENT_TYPES, type MovementType } from "./movement-labels";
import type { MovementFilters } from "./movements";

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

const get = (p: Params, k: string) => {
  const v = p instanceof URLSearchParams ? p.get(k) : p[k];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
};
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Reads Movement history filters from the address bar (page and CSV share this), ignoring anything invalid. */
export function readMovementFilters(p: Params): { filters: MovementFilters; page: number } {
  const type = get(p, "type");
  const who = get(p, "who");
  const page = Number(get(p, "page"));
  return {
    filters: {
      from: isDay(get(p, "from")) ? get(p, "from") : undefined,
      to: isDay(get(p, "to")) ? get(p, "to") : undefined,
      type: (MOVEMENT_TYPES as readonly string[]).includes(type) ? (type as MovementType) : undefined,
      productId: isUuid(get(p, "product")) ? get(p, "product") : undefined,
      who: who && who.length <= 100 ? who : undefined,
      orderRef: get(p, "order").slice(0, 100) || undefined,
    },
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The same filters back as an address query (without the page). */
export function movementQuery(f: MovementFilters) {
  const q = new URLSearchParams();
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.type) q.set("type", f.type);
  if (f.productId) q.set("product", f.productId);
  if (f.who) q.set("who", f.who);
  if (f.orderRef) q.set("order", f.orderRef);
  return q;
}
