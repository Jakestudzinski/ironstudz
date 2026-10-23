import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInbound } from "@/lib/inventory/inbound-guard";
import { withTransaction } from "@/lib/inventory/db";
import { InboundError, errorResponse } from "@/lib/inventory/errors";
import { logInbound } from "@/lib/inventory/log";
import { recordCancellation } from "@/lib/inventory/orders";

export const runtime = "nodejs";

const CancelSchema = z.object({
  type: z.enum(["cancelled", "refunded"]).default("cancelled"),
  cancelled_at: z.string().datetime({ offset: true }).optional(),
});

/** POST /api/inventory/inbound/orders/{order}/cancel — a paid order was cancelled or refunded. */
export async function POST(req: Request, ctx: { params: Promise<{ order: string }> }) {
  const endpoint = "orders/cancel";
  const { order } = await ctx.params;
  const orderRef = decodeURIComponent(order);

  const auth = await authorizeInbound(req, endpoint, orderRef);
  if (auth instanceof Response) return auth;

  let body: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return errorResponse(400, "Body must be valid JSON");
    }
  }
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Invalid cancellation", parsed.error.flatten());

  try {
    const result = await withTransaction((c) =>
      recordCancellation(c, auth.businessId, orderRef, parsed.data.type, parsed.data.cancelled_at)
    );
    await logInbound({ endpoint, statusCode: 200, businessId: auth.businessId, reference: orderRef, payload: parsed.data });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof InboundError ? err.status : 500;
    const message = err instanceof InboundError ? err.message : "Internal error";
    if (status === 500) console.error("inbound cancel failed", err);
    await logInbound({ endpoint, statusCode: status, businessId: auth.businessId, reference: orderRef, error: String(err) });
    return errorResponse(status, message);
  }
}
