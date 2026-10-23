import { pool } from "./db";
import { getAlerts, listCancelledToReview, listOpenIssues, type AlertKey } from "./alerts";
import { emailRecipients } from "./settings";

// The daily email: one per business each morning at its email time (Phoenix), listing what needs attention
// with a link to the screen that fixes each item. A scheduled job calls runDailyEmails() every 15 minutes;
// daily_email_sends makes sure a business never gets two on the same day.

const ZONE = "America/Phoenix";

export type DailyEmail = { subject: string; html: string; text: string; total: number };

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function phoenixToday(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(now); // YYYY-MM-DD
}
function phoenixTime(now: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now); // HH:MM
}

/** Builds today's email for one business. `baseUrl` makes the links absolute, e.g. https://studzstock.example. */
export async function buildDailyEmail(businessId: string, baseUrl: string, now = new Date()): Promise<DailyEmail> {
  const [biz, alerts, cancelled, issues] = await Promise.all([
    pool.query(`SELECT name FROM businesses WHERE id = $1`, [businessId]),
    getAlerts(businessId),
    listCancelledToReview(businessId),
    listOpenIssues(businessId),
  ]);
  const name: string = biz.rows[0]?.name ?? "Inventory";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long", month: "long", day: "numeric" }).format(now);
  const url = (path: string) => baseUrl.replace(/\/$/, "") + path;

  type Section = { title: string; items: { name: string; info: string; href: string }[] };
  const order: AlertKey[] = ["cover", "refill", "low", "testing", "count"];
  const sections: Section[] = [
    ...order.map((k) => ({ title: alerts[k].label, items: alerts[k].items })),
    {
      title: "Cancelled orders to review",
      items: cancelled.map((o) => ({ name: `Order ${o.orderRef}`, info: `${o.type} · ${o.items.join(", ")}`, href: "/admin/inventory" })),
    },
    {
      title: "Order issues",
      items: issues.map((i) => ({
        name: `Order ${i.orderRef}`,
        info: i.issue === "unknown_sku" ? `Unknown SKU ${i.sku}` : `Short on ${i.product ?? i.sku}: ${i.deducted} of ${i.requested} taken`,
        href: "/admin/inventory",
      })),
    },
  ].filter((s) => s.items.length > 0); // skip empty sections

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const subject = total === 0 ? `${name} inventory: all clear` : `${name} inventory: ${total} ${total === 1 ? "thing needs" : "things need"} attention`;

  const counts = sections.map((s) => `${s.items.length} · ${s.title}`);
  const text = [
    `${name} inventory · ${day}`,
    "",
    total === 0 ? "All clear: nothing needs attention today." : counts.join("\n"),
    ...sections.flatMap((s) => ["", s.title.toUpperCase(), ...s.items.map((i) => `- ${i.name}: ${i.info}\n  ${url(i.href)}`)]),
    "",
    `Open the dashboard: ${url("/admin/inventory")}`,
    `Change who gets this email, or when: ${url("/admin/inventory/settings")}`,
  ].join("\n");

  const font = "font-family:'IBM Plex Sans',Segoe UI,Arial,sans-serif";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f1;${font};color:#17201b">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
  <div style="background:#17201b;color:#fff;border-radius:10px 10px 0 0;padding:16px 20px">
    <div style="font-size:18px;font-weight:700">${esc(name)} inventory</div>
    <div style="font-size:13px;color:#c9d0cb">${esc(day)}</div>
  </div>
  <div style="background:#fff;border:1px solid #dadfda;border-top:0;border-radius:0 0 10px 10px;padding:20px">
    ${total === 0
      ? `<p style="margin:0;font-size:16px;color:#1e5b31;font-weight:600">All clear: nothing needs attention today.</p>`
      : `<table role="presentation" style="border-collapse:collapse;margin-bottom:8px">${sections.map((s) =>
          `<tr><td style="padding:2px 12px 2px 0;font-family:'IBM Plex Mono',Consolas,monospace;font-size:18px;color:#9b2219;text-align:right">${s.items.length}</td><td style="font-size:15px">${esc(s.title)}</td></tr>`).join("")}</table>
         ${sections.map((s) => `
         <h2 style="font-size:16px;margin:20px 0 6px">${esc(s.title)}</h2>
         <ul style="margin:0;padding:0;list-style:none">${s.items.map((i) => `
           <li style="padding:8px 0;border-top:1px solid #eceeeb"><a href="${esc(url(i.href))}" style="color:#1d4ed8;font-weight:600;text-decoration:none">${esc(i.name)}</a><br><span style="font-size:14px;color:#3f4943">${esc(i.info)}</span></li>`).join("")}
         </ul>`).join("")}`}
    <p style="margin:24px 0 0"><a href="${esc(url("/admin/inventory"))}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open the dashboard</a></p>
  </div>
  <p style="font-size:12px;color:#5b6660;margin:12px 4px">You get this because you manage ${esc(name)}. <a href="${esc(url("/admin/inventory/settings"))}" style="color:#5b6660">Change who gets it, or when</a>.</p>
</div></body></html>`;

  return { subject, html, text, total };
}

/** Sends through Resend when RESEND_API_KEY is set; otherwise does nothing and reports "preview". */
export async function sendEmail(to: string[], email: DailyEmail): Promise<"sent" | "preview"> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "preview";
  const from = process.env.INVENTORY_EMAIL_FROM;
  if (!from) throw new Error("INVENTORY_EMAIL_FROM is not set (e.g. StudzStock <inventory@studzpeptides.com>)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: email.subject, html: email.html, text: email.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return "sent";
}

const MAX_ATTEMPTS = 3;

/**
 * Called by the scheduled job. For each active business whose email time has passed today (Phoenix), claims
 * today's row in daily_email_sends and sends. A failed send is retried on later runs, up to 3 tries.
 */
export async function runDailyEmails(baseUrl: string, now = new Date()) {
  const today = phoenixToday(now);
  const time = phoenixTime(now);
  const { rows: due } = await pool.query(
    `SELECT b.id, b.name FROM businesses b JOIN alert_settings s ON s.business_id = b.id
      WHERE b.is_active AND to_char(s.email_time, 'HH24:MI') <= $1
        AND NOT EXISTS (SELECT 1 FROM daily_email_sends d WHERE d.business_id = b.id AND d.send_date = $2::date
                         AND (d.status IN ('sent', 'preview', 'sending') OR d.attempts >= $3))`,
    [time, today, MAX_ATTEMPTS]
  );

  const results: { business: string; status: string; error?: string }[] = [];
  for (const b of due) {
    // Claim today's slot. Only one run can win it, so the email can't go twice.
    const claim = await pool.query(
      `INSERT INTO daily_email_sends (business_id, send_date) VALUES ($1, $2::date)
       ON CONFLICT (business_id, send_date) DO UPDATE
         SET status = 'sending', attempts = daily_email_sends.attempts + 1, updated_at = now()
         WHERE daily_email_sends.status = 'failed' AND daily_email_sends.attempts < $3
       RETURNING id`,
      [b.id, today, MAX_ATTEMPTS]
    );
    if (!claim.rows[0]) continue;
    const id = claim.rows[0].id;
    try {
      const to = await emailRecipients(b.id);
      if (to.length === 0) throw new Error("No recipients: add managers with email addresses, or recipients in Settings");
      const status = await sendEmail(to, await buildDailyEmail(b.id, baseUrl, now));
      await pool.query(`UPDATE daily_email_sends SET status = $2, recipients = $3, error = NULL, updated_at = now() WHERE id = $1`, [id, status, to]);
      results.push({ business: b.name, status });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("daily email failed", b.name, message);
      await pool.query(`UPDATE daily_email_sends SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [id, message.slice(0, 1000)]);
      results.push({ business: b.name, status: "failed", error: message });
    }
  }
  return { today, time, results };
}

/** The last few daily emails for the Settings screen. */
export async function recentSends(businessId: string) {
  const { rows } = await pool.query(
    `SELECT to_char(send_date, 'YYYY-MM-DD') AS day, status, recipients, error, updated_at AS at
       FROM daily_email_sends WHERE business_id = $1 ORDER BY send_date DESC LIMIT 7`,
    [businessId]
  );
  return rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })) as {
    day: string; status: "sending" | "sent" | "failed" | "preview"; recipients: string[]; error: string | null; at: string;
  }[];
}
