"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { z } from "zod";
import { withTransaction } from "@/lib/inventory/db";
import { InboundError } from "@/lib/inventory/errors";
import { getSessionUser } from "@/lib/inventory/session";
import { isOwner } from "@/lib/inventory/owner";
import type { ActionResult } from "@/lib/inventory/run-change";
import {
  addManager, createApiKey, createBusiness, newBusinessInput, removeManager, revokeApiKey, setBusinessActive,
} from "@/lib/inventory/admin";

// Owner-only actions (site Admins): businesses, managers and website API keys.
// Every action re-checks on the server that the signed-in user is an Admin.

async function runOwner<T>(fn: (c: PoolClient, ownerId: string) => Promise<T>): Promise<ActionResult<T>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in" };
  if (!(await isOwner(user.id))) return { ok: false, message: "Only site admins can change businesses, managers and API keys" };
  try {
    const data = await withTransaction((c) => fn(c, user.id));
    revalidatePath("/admin/inventory", "layout");
    return { ok: true, data };
  } catch (err) {
    if (err instanceof InboundError) return { ok: false, message: err.message };
    console.error("owner action failed", err);
    return { ok: false, message: "Something went wrong. Nothing was changed. Please try again." };
  }
}

const id = z.string().uuid();
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";

export async function createBusinessAction(input: unknown) {
  const parsed = newBusinessInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) };
  return runOwner((c, ownerId) => createBusiness(c, ownerId, parsed.data));
}

export async function setBusinessActiveAction(businessId: string, on: boolean) {
  if (!id.safeParse(businessId).success) return { ok: false as const, message: "Unknown business" };
  return runOwner((c) => setBusinessActive(c, businessId, !!on));
}

export async function addManagerAction(businessId: string, email: string, name: string) {
  const parsed = z.object({
    businessId: id,
    email: z.string().trim().toLowerCase().email("Enter their email address"),
    name: z.string().trim().max(100),
  }).safeParse({ businessId, email, name });
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) };
  return runOwner((c) => addManager(c, parsed.data.businessId, parsed.data.email, parsed.data.name || null));
}

export async function removeManagerAction(businessId: string, userId: string) {
  if (!id.safeParse(businessId).success || !userId || userId.length > 100) return { ok: false as const, message: "Unknown manager" };
  return runOwner((c) => removeManager(c, businessId, userId));
}

export async function createApiKeyAction(businessId: string, label: string) {
  if (!id.safeParse(businessId).success) return { ok: false as const, message: "Unknown business" };
  return runOwner((c) => createApiKey(c, businessId, label));
}

export async function revokeApiKeyAction(businessId: string, keyId: string) {
  if (!id.safeParse(businessId).success || !id.safeParse(keyId).success) return { ok: false as const, message: "Unknown key" };
  return runOwner((c) => revokeApiKey(c, businessId, keyId));
}
