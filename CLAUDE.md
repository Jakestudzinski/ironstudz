@AGENTS.md

# StudzStock inventory: guide for Claude Code

This site is **StudzStock**, an internal inventory system for the Studz businesses. Business websites are separate;
they send paid orders and cancellations to the inbound API with a per-business API key. Read before changing anything:

- `README.md`: what each screen does, the webhook contract, commands and the going-live checklist.
- `docs/inventory/INVENTORY_SPEC.md`: the original build spec.
- `docs/inventory/DECISIONS.md`: decisions made with the owner since. **These override the spec where they differ.**
- `docs/inventory/design/`: approved screen designs (375 / 768 / 1280 px) and the working prototype.

## Where things are

- Screens: `src/app/admin/inventory/**` (tabs in `_components/InventoryNav.tsx`, shared styles in
  `_components/ui.module.css`, server actions in `stock-actions.ts`, `owner-actions.ts`, `products/actions.ts`,
  `settings/actions.ts`).
- API: `src/app/api/inventory/**` (inbound orders/cancel/receipts, movements CSV, email preview, cron).
- Logic: `src/lib/inventory/**` (plain SQL through `pg`; Prisma is only used for the schema and migrations, and for
  site login).
- Tests: `tests/inventory/*.test.ts`, run with `npm run test:inventory:fresh` against a **throwaway local** database.
- Checks: `scripts/check-screens.mjs`, `scripts/check-a11y.mjs`.

## Rules that must not be broken

- **Every page, server action and query** starts with `requireManager()` / `getInventoryContext()`
  (`src/lib/inventory/context.ts`) or `runChange()` (`run-change.ts`), and filters by the returned business id.
  Never trust a business id sent by the browser.
- **Owner-only** things (businesses, managers, accounts, API keys) check `isOwner()` (site `ADMIN` role, read from the
  database) on the server, every time.
- **Stock is never edited directly.** Every change is a `movements` row plus the matching `stock` update, in one
  transaction with `SELECT … FOR UPDATE` on the stock rows. Movements are never updated or deleted.
- Stock never goes below zero. Only lots with `testing_status = 'passed'` are sold or counted as sellable.
- FIFO = oldest Passed lot by `received_at`, preferring the variant's home location. Reuse `recordPaidOrder()`.
- Paid orders are **never refused because of stock**: unknown SKUs and shortfalls are accepted and flagged.
- Database changes: add a new migration; never edit an applied one; never `prisma db push` (it can drop the CHECK
  constraints and the partial index `stock_counts_one_open_idx` that Prisma can't describe). After a schema change,
  `prisma migrate diff --from-url <local db> --to-schema-datamodel prisma/schema.prisma --exit-code` must report no
  difference.
- Tests run against real PostgreSQL, not mocks. Keep every existing test passing.
- Never run tests or resets against the live database. `scripts/reset-test-db.mjs` refuses anything that isn't a
  local database with "test" in its name.

## Mobile, tablet and accessibility (managers use phones at the packing station)

- Use the `--inv-*` tokens and helpers in `src/app/admin/inventory/inventory.css` and `_components/ui.module.css`.
- Form fields 16px or larger; tap targets at least 44px; page padding via `var(--inv-pad-left/right)`.
- Wide tables render a table **and** a card list, toggled with `.inv-hide-phone/.inv-show-phone` (≤720px) or
  `.inv-hide-tablet/.inv-show-tablet` (≤900px). The page must never scroll sideways.
- Every input has a real label; status pills always carry a word; confirmations and errors use `role="status"` /
  `role="alert"`.
- After changing a screen, run `check-screens.mjs` and `check-a11y.mjs` on it and look at the screenshots.
- Client components must not import modules that use the database. Browser-safe helpers live in `product-meta.ts`,
  `weight-count.ts`, `operation-labels.ts`, `movement-labels.ts`.

## Local development

- A separate PostgreSQL runs from `.devdb/` on port 5433 (start it with
  `"C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" -D .devdb -l .devdb/server.log start`). Databases:
  `studzstock_dev` (try the app) and `inventory_test` (tests). Their addresses and a local test manager are in
  `.env.test`, which is never committed.
- Run the dev server against the local database, e.g.
  `DATABASE_URL=postgresql://postgres@localhost:5433/studzstock_dev NEXTAUTH_URL=http://localhost:3107 npx next dev -p 3107`.
- In Git Bash, set `MSYS_NO_PATHCONV=1` when passing `/admin/...` paths to the check scripts.

## Working style the owner expects

- Build one phase or change at a time. At the end: summarise what changed and how it was tested, and stop for approval.
- Ask before choices that change how the business works (and record the answer in `docs/inventory/DECISIONS.md`);
  make routine technical choices yourself and list them.
- Commit only when asked, on a branch; never push or touch the live database without explicit approval.
- Explain things in plain language; the owner is not a developer.
