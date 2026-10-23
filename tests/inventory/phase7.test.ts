import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool, withTransaction } from "@/lib/inventory/db";
import { authenticateBusiness } from "@/lib/inventory/auth";
import {
  addManager, createApiKey, createBusiness, listAllBusinesses, removeManager, revokeApiKey, setBusinessActive,
} from "@/lib/inventory/admin";
import { emailRecipients, getSettings, settingsInput, updateSettings } from "@/lib/inventory/settings";
import { buildDailyEmail, runDailyEmails } from "@/lib/inventory/daily-email";
import { isOwner, listManagedBusinesses, setActiveBusiness } from "@/lib/inventory/businesses";
import { createProduct } from "@/lib/inventory/product-changes";
import { recordDelivery } from "@/lib/inventory/receipts";

const q = (s: string, p: unknown[] = []) => pool.query(s, p);
const keyRequest = (key: string) => new Request("http://x", { headers: { authorization: `Bearer ${key}` } });

export async function phase7Tests() {
  await q(`insert into "User"(id,name,email,role,"updatedAt") values
    ('owner1','Olive Owner','olive@example.com','ADMIN',now()), ('plain1','Pat Plain','pat@example.com','USER',now())`);

  // ---- Owners are the site's Admins, checked in the database ----
  assert.equal(await isOwner("owner1"), true);
  assert.equal(await isOwner("plain1"), false);
  assert.equal(await isOwner("nobody"), false);

  // ---- Businesses: settings, first manager and an API key that works ----
  const made = await withTransaction((c) => createBusiness(c, "owner1", { name: "Phase7 Peptides", sells: "peptide", createKey: true }));
  assert.match(made.key!, /^inv_[0-9a-f]{64}$/);
  assert.deepEqual(await authenticateBusiness(keyRequest(made.key!)), { businessId: made.businessId });
  assert.equal((await getSettings(made.businessId)).emailTime, "07:00");
  assert.deepEqual((await listManagedBusinesses("owner1")).map((b) => b.name), ["Phase7 Peptides"]);
  await assert.rejects(withTransaction((c) => createBusiness(c, "owner1", { name: "phase7 peptides", sells: "skin_care", createKey: false })), /already a business called/);
  const card = (await listAllBusinesses()).find((b) => b.id === made.businessId)!;
  assert.deepEqual([card.sells, card.managers.map((m) => m.name), card.keys.length], ["peptide", ["Olive Owner"], 1]);

  // ---- Managers: existing account, or a new one with a one-time temporary password ----
  const existing = await withTransaction((c) => addManager(c, made.businessId, "PAT@example.com", null));
  assert.deepEqual([existing.userId, existing.tempPassword], ["plain1", null]);
  await assert.rejects(withTransaction((c) => addManager(c, made.businessId, "pat@example.com", null)), /already a manager/);
  const fresh = await withTransaction((c) => addManager(c, made.businessId, "New.Person@Example.com", "Nina New"));
  assert.ok(fresh.tempPassword && fresh.tempPassword.length >= 10);
  const u = (await q(`select email, name, role, "passwordHash" from "User" where id=$1`, [fresh.userId])).rows[0];
  assert.deepEqual([u.email, u.name, u.role], ["new.person@example.com", "Nina New", "USER"], "new managers are never admins");
  assert.equal(await bcrypt.compare(fresh.tempPassword!, u.passwordHash), true);
  await setActiveBusiness("plain1", made.businessId);
  await withTransaction((c) => removeManager(c, made.businessId, "plain1"));
  assert.deepEqual(await listManagedBusinesses("plain1"), []);
  assert.equal((await q(`select active_business_id from user_preferences where user_id='plain1'`)).rows[0].active_business_id, null);
  await assert.rejects(withTransaction((c) => removeManager(c, made.businessId, "plain1")), /isn't a manager/);

  // ---- Keys: revoking stops orders; another business's key id can't be revoked from here ----
  const second = await withTransaction((c) => createApiKey(c, made.businessId, "Backup site"));
  const keys = (await listAllBusinesses()).find((b) => b.id === made.businessId)!.keys;
  await assert.rejects(withTransaction((c) => revokeApiKey(c, "00000000-0000-0000-0000-000000000000", keys[0].id)), /isn't for this business/);
  await withTransaction((c) => revokeApiKey(c, made.businessId, keys.find((k) => k.label === "Website")!.id));
  assert.equal(await authenticateBusiness(keyRequest(made.key!)), null);
  assert.ok(await authenticateBusiness(keyRequest(second)));

  // ---- Settings ----
  assert.equal(settingsInput.safeParse({ emailTime: "07:10", emailRecipients: [], coverDays: 90, salesWindowDays: 60, testingOverdueDays: 40, countMismatchThreshold: 2 }).success, false, "quarter hours only");
  assert.equal(settingsInput.safeParse({ emailTime: "07:15", emailRecipients: ["not an email"], coverDays: 90, salesWindowDays: 60, testingOverdueDays: 40, countMismatchThreshold: 2 }).success, false);
  assert.deepEqual(await emailRecipients(made.businessId), ["new.person@example.com", "olive@example.com"], "default: every manager");
  const good = settingsInput.parse({ emailTime: "06:45", emailRecipients: ["Ops@Example.com", "ops@example.com"], coverDays: 100, salesWindowDays: 30, testingOverdueDays: 35, countMismatchThreshold: 1 });
  await withTransaction((c) => updateSettings(c, made.businessId, good));
  assert.deepEqual(await getSettings(made.businessId), {
    emailTime: "06:45", emailRecipients: ["ops@example.com"], coverDays: 100, salesWindowDays: 30, testingOverdueDays: 35, countMismatchThreshold: 1,
  });
  assert.deepEqual(await emailRecipients(made.businessId), ["ops@example.com"]);

  // ---- The email: all clear, then with alerts; names are escaped ----
  const other = await withTransaction((c) => createBusiness(c, "owner1", { name: "<b>Shop</b> & Co", sells: "skin_care", createKey: false }));
  let mail = await buildDailyEmail(other.businessId, "https://stock.example/");
  assert.equal(mail.subject, "<b>Shop</b> & Co inventory: all clear");
  assert.match(mail.html, /&lt;b&gt;Shop&lt;\/b&gt; &amp; Co/);
  assert.doesNotMatch(mail.html, /<b>Shop<\/b>/);
  assert.match(mail.text, /All clear/);
  const pid = await withTransaction((c) => createProduct(c, made.businessId, "owner1", {
    name: "Mail pep", strengthSize: "5mg", category: "peptide", vialWeightG: null, isPriority: false,
    variants: [{ packageType: "kit", sku: "MAIL-KIT", homeLocationId: null, minLevel: 5 }] }));
  await withTransaction((c) => recordDelivery(c, "owner1", { business_id: made.businessId, reference: "MAIL-1", lines: [{ sku: "MAIL-KIT", lot_number: "M1", quantity: 2, location: "Back 1" }] }));
  await q(`update lots set received_at = now() - interval '50 days' where product_id=$1`, [pid]);
  mail = await buildDailyEmail(made.businessId, "https://stock.example");
  assert.equal(mail.subject, "Phase7 Peptides inventory: 2 things need attention");
  assert.match(mail.text, /1 · Low stock\n1 · Testing overdue/);
  assert.match(mail.html, /href="https:\/\/stock\.example\/admin\/inventory\/receive\?variant=/);
  assert.match(mail.html, /href="https:\/\/stock\.example\/admin\/inventory\/lots"/);

  // ---- The schedule: once per Phoenix day, at or after the business's time ----
  const at = (iso: string) => new Date(iso); // Phoenix is UTC−7 all year
  const mine = (r: Awaited<ReturnType<typeof runDailyEmails>>) => r.results.filter((x) => x.business === "Phase7 Peptides");
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(mine(await runDailyEmails("https://stock.example", at("2026-11-02T13:40:00Z"))), [], "06:40 is before 06:45");
  assert.deepEqual(mine(await runDailyEmails("https://stock.example", at("2026-11-02T13:45:00Z"))), [{ business: "Phase7 Peptides", status: "preview" }]);
  assert.deepEqual(mine(await runDailyEmails("https://stock.example", at("2026-11-02T14:00:00Z"))), [], "never twice in a day");

  // With Resend: a failed send is retried on later runs, up to 3 tries; a success is sent once
  const realFetch = globalThis.fetch;
  const calls: { to: string[]; subject: string }[] = [];
  let fail = true;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.to.includes("ops@example.com")) calls.push({ to: body.to, subject: body.subject });
    return new Response(fail ? "boom" : "{}", { status: fail ? 500 : 200 });
  }) as typeof fetch;
  process.env.RESEND_API_KEY = "re_test";
  process.env.INVENTORY_EMAIL_FROM = "StudzStock <inventory@example.com>";
  try {
    const day = "2026-11-03T";
    assert.equal(mine(await runDailyEmails("https://s", at(day + "14:00:00Z")))[0].status, "failed");
    assert.equal(mine(await runDailyEmails("https://s", at(day + "14:15:00Z")))[0].status, "failed");
    fail = false;
    assert.equal(mine(await runDailyEmails("https://s", at(day + "14:30:00Z")))[0].status, "sent");
    assert.deepEqual(mine(await runDailyEmails("https://s", at(day + "14:45:00Z"))), []);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2].to, ["ops@example.com"]);
    const row = (await q(`select status, attempts, error from daily_email_sends where business_id=$1 and send_date='2026-11-03'`, [made.businessId])).rows[0];
    assert.deepEqual([row.status, row.attempts, row.error], ["sent", 3, null]);
    // Three failures and it stops trying for the day
    fail = true;
    for (const t of ["14:00", "14:15", "14:30", "14:45"]) await runDailyEmails("https://s", at(`2026-11-04T${t}:00Z`));
    assert.equal((await q(`select attempts from daily_email_sends where business_id=$1 and send_date='2026-11-04'`, [made.businessId])).rows[0].attempts, 3);
    // Switched-off businesses get nothing
    await withTransaction((c) => setBusinessActive(c, made.businessId, false));
    assert.deepEqual(mine(await runDailyEmails("https://s", at("2026-11-05T15:00:00Z"))), []);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }

  console.log("✓ phase 7 tests passed");
}
