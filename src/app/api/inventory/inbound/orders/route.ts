import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInbound } from "@/lib/inventory/inbound-guard";
import { withTransaction } from "@/lib/inventory/db";
import { InboundError, errorResponse } from "@/lib/inventory/errors";
import { logInbound } from "@/lib/inventory/log";
import { recordPaidOrder } from "@/lib/inventory/orders";

export const runtime = "nodejs";

const PaidOrderSchema = z.object({
  order_ref: z.string().trim().min(1).max(100),
  paid_at: z.string().datetime({ offset: true }).optional(),
  lines: z
    .array(z.object({ sku: z.string().trim().min(1).max(100), quantity: z.number().int().positive().max(100000) }))
    .min(1)
    .max(500),
});

/** POST /api/inventory/inbound/orders  — a business website sends a PAID order. */
export async function POST(req: Request) {
  const endpoint = "orders";
  const auth = await authorizeInbound(req, endpoint);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await logInbound({ endpoint, statusCode: 400, businessId: auth.businessId, error: "invalid JSON" });
    return errorResponse(400, "Body must be valid JSON");
  }

  const parsed = PaidOrderSchema.safeParse(body);
  if (!parsed.success) {
    await logInbound({ endpoint, statusCode: 400, businessId: auth.businessId, payload: body, error: "validation failed" });
    return errorResponse(400, "Invalid order", parsed.error.flatten());
  }

  try {
    const result = await withTransaction((c) => recordPaidOrder(c, auth.businessId, parsed.data));
    await logInbound({ endpoint, statusCode: 200, businessId: auth.businessId, reference: parsed.data.order_ref, payload: parsed.data });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof InboundError ? err.status : 500;
    const message = err instanceof InboundError ? err.message : "Internal error";
    if (status === 500) console.error("inbound order failed", err);
    await logInbound({ endpoint, statusCode: status, businessId: auth.businessId, reference: parsed.data.order_ref, payload: parsed.data, error: String(err) });
    return errorResponse(status, message);
  }
}
