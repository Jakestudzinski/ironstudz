# Decisions log

Decisions made with the owner. Where these differ from `INVENTORY_SPEC.md`, these win.

## Business and scope
- Multiple businesses in one system. Each has its own products, stock, lots, alerts, daily email and website API key.
  Physical locations (Back 1, Rack A, Rack C, D6, D3, D2) are shared.
- Businesses can be added from a **Businesses** screen: name, what it mainly sells, managers, optional website API key
  (shown once). **Open question:** who may add businesses and change managers. Recommended: an **owner** role separate
  from managers, so managers can't grant themselves access. Confirm with the owner before building.
- About 4 managers today; no packer or customer access.

## Website and orders
- **Decided 2026-10-22 (overrides the hook-into-the-store plan below):** the inventory lives in the `ironstudz` app.
  Business websites are separate. When an order is **paid** on a business's website, that website sends a webhook to
  `POST /api/inventory/inbound/orders` with that business's API key, and inventory is deducted for that business.
  Cancellations/refunds go to `POST /api/inventory/inbound/orders/{order_ref}/cancel`. We don't change the stores'
  own order or payment code from here; each store only needs to send the webhook.
- **Decided: the inventory system is merged into the main store website**, sharing its database, Auth.js logins and
  admin area. `studzinventory` is the staging folder for that merge.
- The website is a Next.js app using **Auth.js (NextAuth)**, **Prisma** and **CSS modules**.
- Two ways an order becomes paid:
  1. **Card payments** through the site's card processor (automatic).
  2. **Zelle and QuickBooks** payments confirmed manually through Claude, which calls the store's
     `POST /api/orders/{id}/confirm-payment`. That route sets paymentStatus PAID / status PROCESSING, **decrements the
     website's own inventory**, creates the EasyPost label, emails the customer, and credits ambassador commission.
- Hook inventory deduction into **the step where the website already decrements its inventory**, so every payment
  method is covered by one hook. Use the order's `orderNumber` (`ORD-…`) as `order_ref`.
- **Both stock counts run side by side for now.** The website's existing count stays the one the store relies on.
  The new system must never block, fail or delay an order: errors are logged and the order is flagged for review.
- Add a **comparison**: each product's website count next to the new system's total, highlighting differences
  (shown on the Products list and product detail in the design). Switch the website over only once they agree for weeks.
- Old website products are linked to new inventory products during bulk import, so the comparison works.

## Stock rules (confirmed during planning)
- Peptides: sealed kits (10 vials) and half kits (5) are back stock in Back 1; kits are broken open to fill loose vials
  on Rack A / Rack C. Skin care and pre-workouts are single units.
- Lots are tested by **lot number**, about 30 days including shipping. Statuses: In testing → Passed or Failed, set by hand.
  No lab file uploads. No expiry dates. FIFO by date received.
- Stock is deducted when an order is **paid**. Cancelled or refunded paid orders are **not** restocked automatically;
  a manager checks the shelf and adds stock back if needed.
- Movement types: received, sold, break down, transfer, adjustment. No customer returns.
- Adjustment reasons: count correction, damaged, failed testing, order cancelled, other (note required).
- No barcodes. No other integrations (accounting, shipping) in version one.

## Products (decided 2026-10-22, Phase 3)
- **No website count comparison for now.** Stores only send paid orders, not their stock numbers, so the "Website count"
  column and "differ from the website count" summary are left out of Products. Can be added later if stores send counts.
- **Priority is capped at 15 per business and enforced:** marking a 16th is refused until another is un-marked.
- Add/Edit product and Bulk import (CSV) have no approved design; they're built in the same style as the other screens.
  A website product is linked to inventory by its **SKU** (the same SKU the store sends in its paid-order webhook).

## Lots and testing (decided 2026-10-22, Phase 4)
- A lot's Passed/Failed result **can be changed later** (e.g. a recall, or a mis-click): Passed ↔ Failed, or back to
  In testing. Changing a result that was already set needs a note. Every status change is kept with who, when and why.
- Marking a lot **Failed blocks its stock from sale straight away** and offers a one-click **write-off** (adjustment,
  reason "failed testing") for when the stock has been physically thrown out. It is not written off automatically.

## Dashboard and alerts (decided 2026-10-22, Phase 5)
- **Packing station refill** compares the loose vials on **Rack A and Rack C added together** with the vial form's
  min level; the alert shows how many are on each rack.
- **Cancelled orders**: the review shows what the order took, with just a **Mark reviewed** button. Any stock put back
  on the shelf is added separately on the Adjust screen (reason "order cancelled").

## Stock counts (decided 2026-10-22, Phase 6)
- A count can be **finished with some lines left blank**; blank lines are skipped and their stock isn't changed.
- Corrections use the stock **at the moment Finish is pressed** (counted − what the system has then). Lines whose stock
  changed while the count was open are highlighted so they can be rechecked first.

## Owners, email and sign-up (decided 2026-10-22, Phase 7)
- **Owner = the site's existing Admin role.** Only admins can add businesses, choose managers, create site accounts for
  new managers, and create or revoke website API keys. Managers run inventory and edit their business's alert settings.
- **Daily email is sent through Resend.** Needs a Resend account, an API key, and a DNS change on studzpeptides.com to
  verify the sending address. Until RESEND_API_KEY is set, emails are only previewed and nothing is sent.
- **The site is on Vercel Pro**, so a scheduled job runs every 15 minutes and each business can choose its own email
  time in Settings (default 7:00 am Phoenix). Each business gets at most one daily email per Phoenix day.
- **Public sign-up is closed.** New managers get an account made for them by an admin on the Businesses screen.

## Counting by weight (decided 2026-10-22)
- Each product can have the **weight of one vial** (grams). Managers can change it for any product, and there is one
  place to see and edit it for all products at once.
- On the **Stock count** screen, each line can be entered as a number of vials **or** as a weight; the app converts
  weight ÷ vial weight into vials. The scale is zeroed by the person counting, so no container weight is subtracted.
- The result is rounded to the nearest vial. If the weight is more than about a third of a vial away from a whole number,
  the line shows a warning to recount. The weight entered is kept on the count line for the record.

## Alerts
- 90-day cover on up to **15 hand-picked priority products**, using a **60-day** sales average.
- Packing station refill, low stock (per-variant min level), testing overdue after **40 days**,
  count mismatch over **2 units**, cancelled orders to review, order issues.
- Shown on the dashboard and in **one daily email at 7:00 am Phoenix time** to that business's managers.

## Design
- Approved look: dark header with business switcher, light page, white cards, blue actions, IBM Plex Sans / Mono,
  status pills always include a word. See `docs/design/`.
- Mobile and tablet: phones get card lists instead of wide tables, tablets get two-column product cards, 16px form
  fields, 44px tap targets, notch-safe padding.
