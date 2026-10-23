# StudzStock

Inventory for the Studz businesses (research peptides, skin care, pre-workouts). Managers track stock by product,
form, lot and location. When an order is paid on a business's website, that website tells StudzStock and the stock
is taken off automatically, oldest tested lot first.

Sign in at `/login`, then open **Inventory** at `/admin/inventory`. There's no public sign-up: a site admin
creates accounts for new managers on the **Businesses** screen.

---

## For managers: the screens

| Tab | What it's for |
| --- | --- |
| **Dashboard** | What needs attention today (tap a card to see the list, each item links to the fix), cancelled orders to review, order problems, quick actions, priority products, lots in testing, recent activity. |
| **Products** | Every product with what's on hand, in testing, days of cover and status. Add or edit products and their website SKUs. **Bulk import** adds or updates many products from a spreadsheet saved as CSV (download the template on that screen). |
| **Receive** | Record a delivery: reference (e.g. PO number), then each line's product and form, lot number, quantity and shelf. New lots start **In testing** and can't be sold yet. |
| **Lots** | Mark lots **Passed** or **Failed** when results come back (about 30 days; flagged as overdue after 40). A result can be changed later with a note. Failed stock is blocked from sale at once; **Write off stock** removes it once it's been thrown out. |
| **Break down** | Open a sealed kit (10 vials) or half kit (5) into loose vials on Rack A or Rack C. Picks the oldest passed lot for you. |
| **Move** | Move stock between locations. |
| **Adjust** | Add or remove stock with a reason: count correction, damaged, failed testing, order cancelled (put back on the shelf), or other (needs a note). |
| **Count** | Count one location: enter what's on the shelf, by number or, for loose vials, by **weight**. Finishing corrects the stock and records every difference. Blank lines are skipped. |
| **History** | Every stock change ever made, who made it and why. Filter it and **Download CSV**. Nothing can be edited or deleted; mistakes are fixed with an adjustment. |
| **Vial weights** | The weight of one vial for each product, used when counting by weight. |
| **Settings** | Alert thresholds and the daily email (time and who gets it). Admins also manage the website API keys here. |
| **Businesses** | *Admins only.* Add businesses, add or remove managers (creating their account if needed), create and revoke website keys, switch a business off. |

Rules the system enforces: stock never goes below zero; only **Passed** lots are sold or counted as sellable; every
change is recorded; each manager only ever sees the businesses they manage.

### The daily email

Each business's managers (or the people chosen in Settings) get one email a day at the set time (default 7:00 am
Phoenix time) with everything on the dashboard that needs attention, or "all clear". **Send test email now** in
Settings sends today's email to yourself; **Preview today's email** shows it on screen.

---

## For whoever runs each store's website: sending paid orders

Ask a StudzStock admin for the business's **API key** (Settings or Businesses → API keys). It's shown once; keep it
secret, like a password. Send it on every request as `Authorization: Bearer <key>`. The key decides which business
the order belongs to.

### When an order is paid

```
POST https://<studzstock-site>/api/inventory/inbound/orders
Authorization: Bearer inv_…
Content-Type: application/json

{
  "order_ref": "ORD-8841",
  "paid_at": "2026-10-22T18:04:00Z",
  "lines": [
    { "sku": "BPC15710MG-KIT", "quantity": 1 },
    { "sku": "BPC15710MG-VIAL", "quantity": 3 }
  ]
}
```

- `order_ref`: the store's order number. Sending the same order again does nothing (safe to retry).
- `paid_at`: optional, ISO 8601 with a time zone. Defaults to now.
- `sku`: must match the **website SKU** set on the product's form in StudzStock exactly.
- The answer is always `200` once the order is accepted, even if a SKU is unknown or there isn't enough stock. Those
  are flagged on the dashboard under **Order issues** (`"status": "needs_review"`); the order is never refused because
  of stock.

### When a paid order is cancelled or refunded

```
POST https://<studzstock-site>/api/inventory/inbound/orders/ORD-8841/cancel
Authorization: Bearer inv_…
Content-Type: application/json

{ "type": "refunded" }        // or "cancelled" (the default); optional "cancelled_at"
```

Stock is **not** put back automatically. The order appears under **Cancelled orders to review**; a manager checks the
shelf and adds anything back with an adjustment.

### Errors and limits

| Status | Meaning | What the website should do |
| --- | --- | --- |
| `200` | Accepted (`"duplicate": true` if it was already received) | Nothing |
| `400` | The request body is wrong (`details` says what) | Fix the request |
| `401` | Missing, wrong or revoked key | Check the key |
| `404` | Cancel for an order StudzStock never received as paid | Send the paid order first |
| `429` | Too many requests (over 120 a minute for the business, or too many wrong keys) | Wait for the `Retry-After` seconds, then retry |
| `5xx` | Something went wrong on our side | Retry later; the same `order_ref` is only ever counted once |

Every request is logged (with its status) so problems can be traced.

---

## For developers

Stack: Next.js 16 (App Router) · TypeScript strict · PostgreSQL · Prisma 6 (schema and migrations) + `pg` (stock
changes, with row locks) · NextAuth v4 (credentials) · CSS modules (inventory) and Tailwind (rest of site) · zod.
Times are stored in UTC and shown in America/Phoenix. See `CLAUDE.md` for the rules the code must follow, and
`docs/inventory/` for the spec, decisions log and approved designs.

### Run it locally

```bash
npm install
npx playwright install chromium     # once, for the screen and accessibility checks
cp .env.example .env.local          # then fill in DATABASE_URL (local!) and NEXTAUTH_SECRET
npm run db:migrate                  # applies prisma/migrations
npm run db:seed                     # creates an admin user (SEED_ADMIN_* in .env.local)
npm run dev                         # http://localhost:3000
```

Never point `.env.local` at the live database while developing.

### Checks

```bash
npm run typecheck
npm run lint
npm test                                   # the site's own tests (Vitest)
DATABASE_URL=postgresql://…/inventory_test npm run test:inventory:fresh
                                           # empties the TEST database, migrates, runs every inventory test.
                                           # Refuses unless the database is local and its name contains "test".
node scripts/check-screens.mjs http://localhost:3000 /admin/inventory /admin/inventory/products …
node scripts/check-a11y.mjs   http://localhost:3000 /admin/inventory /admin/inventory/products …
                                           # set CHECK_EMAIL / CHECK_PASSWORD (a local test manager) to sign in first
```

`check-screens` fails on sideways scrolling, form fields under 16px and tap targets under 44px at 375, 768, 1024 and
1280 px wide. `check-a11y` runs the axe-core WCAG 2.1 AA rules at desktop and phone width.

### Database changes

Always add a new migration in `prisma/migrations/` (`npx prisma migrate dev --create-only`, then check the SQL), and
apply with `npm run db:migrate`. **Don't use `npm run db:push`** on a database that has the inventory tables: Prisma
can't describe some of the inventory's safety rules (CHECK constraints and the "one open count per location" partial
index) and `db push` could remove them.

### Settings (environment variables)

Documented in `.env.example`. Inventory-specific ones:

| Name | What it's for |
| --- | --- |
| `RESEND_API_KEY` | Sends the daily email through Resend. Without it, emails are only previewed. |
| `INVENTORY_EMAIL_FROM` | The sender, on a domain verified in Resend, e.g. `StudzStock <inventory@studzpeptides.com>`. |
| `INVENTORY_BASE_URL` | The site's public address, for links in the email. Falls back to `NEXTAUTH_URL`. |
| `CRON_SECRET` | Long random value. Vercel Cron sends it to `/api/inventory/cron/daily-email` (every 15 min, see `vercel.json`). |

`NEXTAUTH_SECRET` must be a fresh random value in production (`openssl rand -base64 32`), not the example one.

### Going live (checklist)

1. Back up the live database (or confirm a recent backup exists).
2. The live database was set up with `db push`, so it has no migration history yet. Mark the starting point as
   already applied, then apply the inventory migrations:
   ```bash
   DATABASE_URL=<live> npx prisma migrate resolve --applied 0_init
   DATABASE_URL=<live> npx prisma migrate deploy
   ```
3. In Vercel, set `RESEND_API_KEY`, `INVENTORY_EMAIL_FROM`, `INVENTORY_BASE_URL`, `CRON_SECRET` (and check
   `NEXTAUTH_SECRET`), then deploy the branch.
4. Make sure at least one account has the `ADMIN` role, sign in, and add the real businesses, managers and keys on
   **Businesses**. Import products with **Bulk import**, then **Receive** the stock that's on the shelves and mark the
   lots' testing results.
5. Give each store's website its key and the order/cancel details above, and send a test order.
