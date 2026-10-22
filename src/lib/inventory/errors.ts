import { NextResponse } from "next/server";

/** An expected error that should be returned to the caller with a status code. */
export class InboundError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function errorResponse(status: number, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: message, ...(details ? { details } : {}) }, { status });
}
