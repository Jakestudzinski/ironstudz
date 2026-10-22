import { NextResponse } from "next/server";
import { z } from "zod";
import { withTransaction } from "@/lib/inventory/db";
import { InboundError, errorResponse } from "@/lib/inventory/errors";
import { logInbound } from "@/lib/inventory/log";
import { recordDelivery } from "@/lib/inventory/receipts";
import { userCanManage } from "@/lib/inventory/businesses";
import { getSessionUser } from "@/lib/inventory/session";

export const runtime = "nodejs";

const DeliverySchema = z.object({
  business_id: z.string().uuid(),
  reference: z.string().trim().min(1).max(100),
  received_at: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(2000).optional(),
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(100),
        lot_number: z.string().trim().min(1).max(100),
        quantity: z.number().int().positive().max(100000),
        location: z.string().trim().min(1).max(50).optional(),
      })
    )
    .min(1)
    .max(200),
});

/**
 * POST /api/inventory/inbound/receipts — a manager records a stock delivery.
 * Uses the website login (not an API key); powers the Receive stock screen.
 */
export async function POST(req: Request) {
  const endpoint = "receipts";
  const user = await getSessionUser();
  if (!user) return errorResponse(401, "Please sign in");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Body must be valid JSON");
  }
  const parsed = DeliverySchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Invalid delivery", parsed.error.flatten());

  const d = parsed.data;
  if (!(await userCanManage(user.id, d.business_id))) {
    await logInbound({ endpoint, statusCode: 403, businessId: d.business_id, reference: d.reference, error: `user ${user.id} not a manager` });
    return errorResponse(403, "You don't have access to this business");
  }

  try {
    const result = await withTransaction((c) => recordDelivery(c, user.id, d));
    await logInbound({ endpoint, statusCode: 200, businessId: d.business_id, reference: d.reference, payload: d });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof InboundError ? err.status : 500;
    const message = err instanceof InboundError ? err.message : "Internal error";
    if (status === 500) console.error("inbound receipt failed", err);
    await logInbound({ endpoint, statusCode: status, businessId: d.business_id, reference: d.reference, payload: d, error: String(err) });
    return errorResponse(status, message);
  }
}
