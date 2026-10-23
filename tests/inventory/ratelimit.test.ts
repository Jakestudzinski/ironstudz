import assert from "node:assert/strict";
import { pool, withTransaction } from "@/lib/inventory/db";
import { createBusiness } from "@/lib/inventory/admin";
import { LIMITS, hit } from "@/lib/inventory/rate-limit";
import { authorizeInbound } from "@/lib/inventory/inbound-guard";
import { POST as postOrder } from "@/app/api/inventory/inbound/orders/route";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);
const req = (ip: string, key?: string) =>
  new Request("http://x/api/inventory/inbound/orders", {
    method: "POST",
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ order_ref: "RL-" + Math.random(), lines: [{ sku: "NONE", quantity: 1 }] }),
  });

export async function rateLimitTests() {
  await q(`insert into "User"(id,name,email,role,"updatedAt") values ('rl-owner','RL','rl@example.com','ADMIN',now()) on conflict do nothing`);
  const { businessId, key } = await withTransaction((c) => createBusiness(c, "rl-owner", { name: "Rate Limit Co", sells: "peptide", createKey: true }));

  // ---- Fixed windows: the 4th hit in a window is refused, a new window starts fresh ----
  const t = Date.parse("2026-11-01T10:00:05Z");
  const small = { max: 3, windowSeconds: 60 };
  for (let i = 1; i <= 3; i++) assert.equal((await hit("test:a", small, t)).allowed, true);
  const over = await hit("test:a", small, t + 1000);
  assert.deepEqual([over.allowed, over.count, over.retryAfter], [false, 4, 54]);
  assert.equal((await hit("test:a", small, t + 60_000)).allowed, true, "next minute starts again");
  assert.equal((await hit("test:b", small, t)).allowed, true, "buckets are separate");

  // ---- Wrong keys: after 20 from one IP, that IP is refused even with a good key; other IPs are fine ----
  for (let i = 0; i < LIMITS.badKeys.max; i++) {
    const r = await authorizeInbound(req("203.0.113.9", "inv_wrong"), "orders");
    assert.equal((r as Response).status, 401);
  }
  const blocked = await authorizeInbound(req("203.0.113.9", key!), "orders");
  assert.equal((blocked as Response).status, 429);
  assert.ok(Number((blocked as Response).headers.get("retry-after")) > 0);
  assert.deepEqual(await authorizeInbound(req("198.51.100.4", key!), "orders"), { businessId });

  // ---- Per business: 120 a minute, whatever IPs they come from ----
  await q(`delete from rate_limits where bucket = $1`, [`biz:${businessId}`]);
  for (let i = 0; i < LIMITS.perBusiness.max; i++) {
    const r = await authorizeInbound(req(`192.0.2.${i % 250}`, key!), "orders");
    assert.ok(!(r instanceof Response), `request ${i + 1} allowed`);
  }
  const tooMany = await authorizeInbound(req("192.0.2.251", key!), "orders");
  assert.equal((tooMany as Response).status, 429);

  // ---- Through the real route: 429 with Retry-After, and the refusal is logged ----
  const res = await postOrder(req("192.0.2.252", key!));
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /Too many requests for this business/);
  assert.ok((await q(`select count(*)::int n from inbound_requests where business_id=$1 and status_code=429`, [businessId])).rows[0].n >= 2);

  console.log("✓ rate limit tests passed");
}
