"use server";

import { z } from "zod";
import { runChange, type ActionResult } from "@/lib/inventory/run-change";
import { recordDelivery } from "@/lib/inventory/receipts";
import { markCancelledReviewed, resolveIssue } from "@/lib/inventory/alerts";
import { addCountLine, cancelCount, finishCount, saveCountLine, startCount } from "@/lib/inventory/counts";
import {
  adjust, adjustInput, breakDown, breakDownInput, lotStatusInput, setLotStatus, transfer, transferInput, writeOffLot,
} from "@/lib/inventory/operations";

// Server actions for the daily stock screens. Each one checks the input, then runs in one transaction
// for the manager's active business (never a business id sent by the browser).

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";

const deliveryInput = z.object({
  reference: z.string().trim().min(1, "Enter the delivery reference, e.g. the PO number").max(100),
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1, "Choose a product and form on every line").max(100),
        lot_number: z.string().trim().min(1, "Enter the lot number on every line").max(100),
        quantity: z.number().int("Quantities must be whole numbers").positive("Quantities must be at least 1").max(100000),
        location: z.string().trim().max(50).optional(),
      })
    )
    .min(1, "Add at least one line")
    .max(200),
});

export type DeliveryResult = { duplicate: boolean; lines: { sku: string; lot_number: string; quantity: number; location: string; new_lot: boolean; lot_status: string }[] };

export async function receiveStockAction(input: unknown): Promise<ActionResult<DeliveryResult>> {
  const parsed = deliveryInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return runChange(async (c, businessId, userId) => {
    const r = await recordDelivery(c, userId, { business_id: businessId, ...parsed.data });
    return { duplicate: r.duplicate, lines: ("lines" in r && r.lines) || [] };
  });
}

export async function breakDownAction(input: unknown) {
  const parsed = breakDownInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) };
  return runChange((c, b, u) => breakDown(c, b, u, parsed.data));
}

export async function transferAction(input: unknown) {
  const parsed = transferInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) };
  return runChange((c, b, u) => transfer(c, b, u, parsed.data));
}

export async function adjustAction(input: unknown): Promise<ActionResult> {
  const parsed = adjustInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return runChange((c, b, u) => adjust(c, b, u, parsed.data));
}

export async function setLotStatusAction(input: unknown) {
  const parsed = lotStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) };
  return runChange((c, b, u) => setLotStatus(c, b, u, parsed.data));
}

export async function writeOffLotAction(lotId: string) {
  if (!z.string().uuid().safeParse(lotId).success) return { ok: false as const, message: "Unknown lot" };
  return runChange((c, b, u) => writeOffLot(c, b, u, lotId));
}

export async function markCancelledReviewedAction(orderId: string) {
  if (!z.string().uuid().safeParse(orderId).success) return { ok: false as const, message: "Unknown order" };
  return runChange((c, b, u) => markCancelledReviewed(c, b, u, orderId));
}

export async function resolveIssueAction(issueId: string, note: string) {
  const parsed = z.object({ issueId: z.string().uuid(), note: z.string().trim().min(1, "Add a note saying how it was resolved").max(500) })
    .safeParse({ issueId, note });
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) };
  return runChange((c, b, u) => resolveIssue(c, b, u, parsed.data.issueId, parsed.data.note));
}

// ---- Stock counts ----

const uuid = z.string().uuid();

export async function startCountAction(locationId: string) {
  if (!uuid.safeParse(locationId).success) return { ok: false as const, message: "Choose a location" };
  return runChange((c, b, u) => startCount(c, b, u, locationId));
}

export async function saveCountLineAction(countId: string, lineId: string, counted: number | null, weightG: number | null) {
  const parsed = z.object({
    countId: uuid, lineId: uuid,
    counted: z.number().int("Counts must be whole numbers").min(0, "Counts can't be negative").max(1000000).nullable(),
    weightG: z.number().positive("Weight must be more than 0").max(1000000).nullable(),
  }).safeParse({ countId, lineId, counted, weightG });
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) };
  const d = parsed.data;
  return runChange((c, b) => saveCountLine(c, b, d.countId, d.lineId, { counted: d.counted, weightG: d.weightG }));
}

export async function addCountLineAction(countId: string, variantId: string, lotId: string) {
  if (![countId, variantId, lotId].every((x) => uuid.safeParse(x).success)) return { ok: false as const, message: "Choose a form and lot" };
  return runChange((c, b) => addCountLine(c, b, countId, variantId, lotId));
}

export async function finishCountAction(countId: string) {
  if (!uuid.safeParse(countId).success) return { ok: false as const, message: "Unknown count" };
  return runChange((c, b, u) => finishCount(c, b, u, countId));
}

export async function cancelCountAction(countId: string) {
  if (!uuid.safeParse(countId).success) return { ok: false as const, message: "Unknown count" };
  return runChange((c, b, u) => cancelCount(c, b, u, countId));
}
