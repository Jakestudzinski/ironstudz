# Inventory System Build Spec (Next.js)

Source: the "Build Prompt: Multi-Business Inventory System" doc, Oct 2026. Later decisions are in `DECISIONS.md` and win where they differ.

## Role, context and goals

You are a senior full-stack engineer adding an internal inventory management system to an existing, live Next.js website backed by PostgreSQL. The site already takes and records paid orders, and its users already sign in. Build the inventory system following this spec exactly. Where the spec is silent, choose the simplest robust option and list the assumption in your summary.

### The business

- The system tracks stock for **multiple businesses** under one roof. Today's main business sells research peptides (about 125 products), skin care, and later pre-workouts.
- Peptides are sold as **sealed kits (10 vials)**, **sealed half kits (5 vials)**, and **single loose vials**. Skin care and pre-workouts are single units.
- Sealed kits are back stock. Managers **break kits open** to restock loose vials at the packing station.
- Every delivery is a **lot** that is lab-tested before it can be sold. Testing takes about 30 days.
- Around **4 managers** use the system. No packer or customer access.

### Goals

1. Live, accurate stock for every product, form, lot and location, per business.
2. Automatic stock deduction when a website order is paid, first in first out.
3. No untested or failed stock is ever sold.
4. A full, permanent audit trail of every stock change and who made it.
5. Early warnings: 90-day stock cover on hand-picked priority products, refills, low stock, overdue testing, count mismatches, and cancelled orders.

### Existing code to reuse

`db/schema.sql`, `db/002_foundation.sql`, `prisma/`, `lib/inventory/*` and `app/api/inventory/inbound/*` are tested. Treat them as the source of truth for tables and inbound behaviour. Extend them; do not rewrite or rename them without asking.

### Stack constraints

- Next.js App Router, TypeScript strict mode, server components by default, server actions or route handlers for writes.
- PostgreSQL. Every multi-step stock change runs in one transaction with row locks.
- Validate every input with zod. No new paid services without asking.
- All times stored in UTC and shown in **America/Phoenix**.

## Business rules

These rules are non-negotiable. Enforce them in the database where possible and in server code everywhere else, never only in the UI.

### Businesses and access

- Every product, variant, lot, stock line, movement, order, receipt and setting belongs to exactly one business.
- A manager only sees and changes businesses they are linked to in `business_users`. Every query filters by business.
- The header has a business switcher. The selected business is kept per user and checked on the server for every request.
- Physical locations are shared across businesses.

### Products and package types

- A **product** is one item at one strength or size, e.g. BPC-157 10mg.
- A **variant** is a sellable form with its own website SKU: kit (10 units), half kit (5), vial (1), or unit (1, for skin care and pre-workouts).
- Each variant has a home location and a `min_level` alert threshold.
- Products and variants are switched off with `is_active`, never deleted once they have history.

### Locations

Back 1 (refrigerated back stock for sealed kits), Rack A and Rack C (packing station), and cupboards D6, D3 and D2. Temperature is not tracked.

### Lots and testing

- Each delivery line creates or adds to a **lot**: a lot number belonging to a product, shared by all its forms.
- New lots start **In testing**. A manager marks them **Passed** or **Failed** by hand; record who and when. No lab file uploads.
- Only **Passed** stock can be sold or counted toward days of cover. Failed stock is blocked and written off with an adjustment (reason: failed testing).
- Products do not expire. There is no expiry date.

### Stock and movements

- Stock is held per variant + lot + location and can never go below zero.
- Stock is **never edited directly**. Every change is a movement: received, sold, break down, transfer, or adjustment.
- Adjustment reasons: count correction, damaged, failed testing, order cancelled, other (a note is required for other).
- Movements are permanent: never updated or deleted. Mistakes are fixed with a correcting adjustment.
- A **break down** writes two linked movements with one `group_id`: −1 kit (or half kit) from its location, +10 (or +5) vials at Rack A or Rack C, same lot.

### Orders

- Stock is deducted the moment an order is **paid**, FIFO: oldest Passed lot by received date first, preferring the variant's home location, spilling to the next lot as needed.
- The same order is only ever deducted once.
- Unknown SKUs or a shortfall still accept the order, deduct what exists, and flag it for review.
- A cancelled or refunded paid order is **not** restocked automatically. It appears in "Cancelled orders to review". A manager checks the shelf, optionally adds stock back with an adjustment (reason: order cancelled), then marks it reviewed.

## Data model

Created by `prisma/migrations/20261022000000_inventory/migration.sql` (also `db/schema.sql` + `db/002_foundation.sql`). Prisma models in `prisma/inventory-models.prisma`.

| Table | Holds | Key fields and constraints |
| --- | --- | --- |
| businesses | Each business | name, is_active |
| business_users | Which managers can access which business | (business_id, user_id) primary key; user_id is the site's user id as text |
| api_keys | API keys for business websites | SHA-256 key_hash only, label, revoked_at |
| locations | Shared physical spots | name unique; area: back_stock, packing_station, storage; seeded with the six locations |
| products | One item at one strength or size | business_id, name, category (peptide, skin_care, pre_workout), strength_size, is_priority, is_active |
| variants | Sellable forms | business_id, product_id, package_type (kit, half_kit, vial, unit), units_per_package, sku unique per business, home_location_id, min_level, is_active |
| lots | Deliveries of a product | product_id, lot_number unique per product, received_at (sets FIFO order), testing_status (in_testing, passed, failed), status_changed_at/by, notes |
| stock | Live counts | variant_id + lot_id + location_id unique, quantity ≥ 0 |
| movements | Permanent log of every change | business_id, movement_type, variant, lot, from/to location, quantity > 0, reason, order_ref, receipt_id, user_id (null = website), group_id, notes, created_at |
| receipts | Deliveries recorded by managers | reference unique per business, received_at, created_by |
| inbound_orders | Paid orders received | order_ref unique per business, paid_at, status (processed, needs_review), cancelled_at, cancel_type, cancel_reviewed_at/by |
| inbound_order_issues | Order problems | sku, quantity requested and deducted, issue (unknown_sku, insufficient_stock), resolved_at/by |
| inbound_requests | Log of every inbound API call | endpoint, reference, status_code, payload, error |
| alert_settings | One row per business | email_time 07:00, email_recipients, cover_days 90, sales_window_days 60, testing_overdue_days 40, count_mismatch_threshold 2 |
| stock_counts | A count session per location | business, location, status (open, finished, cancelled), started/finished by and at; one open count per location |
| stock_count_lines | Lines of a count | variant + lot, expected and counted quantities |
| user_preferences | Business switcher choice | user_id, active_business_id |

Derived values (SQL views or server functions):

- **Vial equivalents** per product: sum of Passed stock quantity × units_per_package.
- **Average daily sales** per product: vial equivalents sold in the last `sales_window_days`, divided by that many days.
- **Days of cover** = vial equivalents ÷ average daily sales, rounded down; show "no sales" when the average is zero.

## API endpoints

Three inbound endpoints exist and are tested. Keep their request and response shapes unchanged.

| Endpoint | Caller | Auth | Behaviour |
| --- | --- | --- | --- |
| POST /api/inventory/inbound/orders | A business website, when an order is paid | API key (Bearer) | FIFO deduction, idempotent by order_ref, flags shortfalls |
| POST /api/inventory/inbound/orders/{order_ref}/cancel | A business website | API key | Marks cancelled or refunded; no restock |
| POST /api/inventory/inbound/receipts | Receive stock screen | Manager login | Records a delivery; new lots In testing; idempotent by reference |

**Connect the live site's orders.** Where the site confirms payment, call `recordPaidOrder()` inside a transaction (same app), or POST to the orders endpoint (separate app). Do the same for cancellations and refunds. Backfill the last 60 days of order history as Sold movements, without touching current stock, so days of cover works from day one. (See DECISIONS.md: hook where the site already decrements its own inventory, and never block the order.)

**Manager actions** (server actions or route handlers, all requiring a manager of the active business, all transactional):

| Action | Effect |
| --- | --- |
| Break down | −1 kit or half kit of a chosen lot from Back 1, +10 or +5 vials of the same product's vial variant, same lot, to Rack A or C; one group_id. Default to the oldest Passed lot. |
| Transfer | Move a quantity of a variant + lot between two locations. |
| Set lot status | in_testing → passed or failed, recording who and when. Failed offers a one-click write-off adjustment. |
| Adjustment | Add or remove stock with a required reason; "other" requires a note. |
| Stock count | Start a count for a location, enter counted quantities, finish to post count-correction adjustments. |
| Review cancelled order | Optional restock adjustment, then mark reviewed. |
| Resolve order issue | Mark an unknown-SKU or shortfall issue resolved with a note. |
| Products and variants | Create, edit, toggle active, set priority (max 15 per business, warn above), set min_level and home location. |
| Bulk import | Upload a CSV of products and variants; preview with row-level errors; import in one transaction; match on SKU to update. |
| Businesses | Add a business, choose managers, create its API key (shown once). Restricted to owners (pending confirmation). |
| Settings | Edit alert_settings for the active business. |
| API keys | Create (show once), label and revoke keys per business. |

**Reads:** dashboard summary, product list with filters (category, location, priority, active), product detail with stock by form, lot and location, lot list by status, and movement history filtered by date range, type, product, user and order, paginated, with CSV export.

## Screens and UI

All pages live under `/admin/inventory`, are visible only to managers, and must work well on a phone at the packing station as well as on a PC. Match `docs/design/`.

**Look and feel:** dark header (#17201B) with the business switcher, light grey page (#F3F4F1), white cards with 1px #DADFDA borders and 10px corners, blue actions (#1D4ED8), IBM Plex Sans for text and IBM Plex Mono for numbers. Status pills always carry a word: OK (green), Watch (amber), Reorder or Overdue (red), In testing (blue). Touch targets at least 44px, form fields at least 16px, real labels on every input, visible focus states.

| Screen | Route | What it does |
| --- | --- | --- |
| Dashboard | /admin/inventory | Alert cards (tap to expand), cancelled orders to review, order issues, quick actions (Break down kit, Receive stock, Update testing), priority products table, lots in testing, last 10 movements |
| Break down kit | /break-down | Product, kit or half kit, lot (defaults to oldest Passed), destination Rack A or C; shows before and after counts |
| Receive stock | /receive | Delivery reference, then lines: product and form, lot number, quantity, location (defaults to home); new lots start In testing |
| Lots and testing | /lots | Lots grouped by status with days waiting; Passed and Failed buttons; overdue lots highlighted |
| Products | /products | Search (name, strength, SKU) and filter by category, location, priority, inactive; sort by name, days of cover, total; sellable mix, in-testing, days of cover, status, website count comparison |
| Product detail | /products/[id] | Stats (sellable, in testing, sales/day, days of cover), website-count warning, stock by form, lot and location; variants with SKUs, home location and editable min levels; priority and active switches; history |
| Transfer | /transfer | Variant, lot, from, to, quantity |
| Stock count | /count | Pick a location, enter counts against expected, review differences, finish |
| Adjustment | /adjust | Variant, lot, location, plus or minus quantity, reason, note |
| Movement history | /movements | Filterable, paginated log with CSV export |
| Businesses | /businesses | Business cards with managers and API key status; add business; edit managers; create key |
| Settings | /settings | Alert thresholds, email time and recipients, API keys |
| Bulk import | /import | CSV upload with preview, errors and confirm |

Dashboard detail: priority table columns are product, on-hand mix ("48 kits · 6 half · 30 vials"), total vial equivalents, sales per day, days of cover, status (OK ≥ 90 days, Watch 60–89, Reorder < 60). Every alert item links to the screen that fixes it, pre-filled. Every successful action shows a short confirmation and appears in recent activity immediately. Errors say exactly what to fix.

## Alerts and daily email

Alerts are computed live per business from current data and `alert_settings`; only who reviewed or resolved an item is stored.

| Alert | Triggers when | Applies to |
| --- | --- | --- |
| Below 90-day cover | Days of cover < cover_days (90), Passed stock, 60-day average | Priority products (up to 15) |
| Packing station refill | Loose vials of a vial variant at Rack A or C < its min_level | Vial variants |
| Low stock | Total Passed stock of a variant < its min_level | All other active variants |
| Testing overdue | Lot In testing longer than testing_overdue_days (40) | All lots |
| Count mismatch | Finished count line off by more than count_mismatch_threshold (2), last 7 days | All counts |
| Cancelled orders to review | Paid order cancelled or refunded, not yet reviewed | All orders |
| Order issues | Unresolved unknown-SKU or shortfall issue | All orders |

Daily email: one per business each morning at `email_time` (7:00 am America/Phoenix) to `email_recipients` (default: that business's managers). A count per alert type, then each item with a link to the screen that fixes it; skip empty sections; "all clear" when nothing needs attention. Send through the site's existing email provider, triggered by a scheduled job hitting a secret-protected route every 15 minutes, recording each send so it never goes twice. Settings has "Send test email now".

## Security

- Every inventory page, action and read checks on the server that the user is signed in and manages the active business.
- API keys stored only as SHA-256 hashes, shown once, revocable. A key alone decides the business.
- Parameterised SQL only. zod on every input. Rate-limit the inbound endpoints.
- No secrets in client code. Document every env var in `.env.example`.

## Testing

Automated tests against a real PostgreSQL test database covering at least: FIFO across lots and locations skipping In testing and Failed lots; duplicate orders and deliveries processed once; shortfalls and unknown SKUs flagged, stock never below zero; two simultaneous orders never oversell; break down keeps the lot and total vial equivalents; stock counts post the right adjustments; no cross-business access; days of cover and every alert boundary (59, 60, 89, 90 days; 40 and 41 days in testing). Plus `scripts/check-screens.mjs` on every screen.

## Build order

Stop after each phase, summarise what changed and how to test it, and wait for approval.

1. **Foundation** — done.
2. **Orders connection:** paid orders, cancellations and refunds from the live site; 60-day backfill; comparison with the website count.
3. **Products:** list, detail, create and edit, priority, bulk import (including linking to website products).
4. **Daily operations:** Receive stock, Lots and testing, Break down, Transfer, Adjustment.
5. **Dashboard and alerts:** all alert calculations, cancelled orders and issues review.
6. **Stock counts and movement history**, with CSV export.
7. **Daily email, settings, businesses and API keys.**
8. **Hardening:** full test suite, mobile and tablet checks, accessibility pass, README for the team.

## Acceptance criteria

- [ ] A paid order (card or Zelle) reduces stock within seconds, from the oldest Passed lot, and shows in recent activity as "Website".
- [ ] A received lot cannot be sold until a manager marks it Passed.
- [ ] Breaking down a kit moves it from Back 1 to 10 vials on the chosen rack, same lot, logged as one action.
- [ ] A cancelled paid order appears for review and stock only returns when a manager adds it back.
- [ ] Priority products show correct days of cover and status, and alerts match the thresholds in settings.
- [ ] Each business's managers see only that business's data.
- [ ] Every stock change appears in movement history with who, when and why, and none can be edited or deleted.
- [ ] The daily email arrives at 7:00 am Phoenix time with working links.
- [ ] Every screen passes `check-screens.mjs` and matches the design at phone, tablet and desktop widths.
