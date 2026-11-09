<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Claude operations (added by the SOP-029 rollout)
- Requests: fixes, improvements and new-site requests come in through Studz Requests (see SOP-029). Claude plans first, then opens a PR; it never pushes straight to `main`.
- CI: `.github/workflows/ci.yml` runs the test script and a type-error ratchet (fails only on NEW errors; baseline in `.github/ci/tsc-baseline.json`), then labels the PR `risk:green|yellow|red` from `.github/ci/risk-paths.json`. Require the check **CI gate**.
- Risk tiers: green may auto-merge once CI passes; yellow needs a second-reviewer pass and a short objection window; red (money, auth, customer data, schema, env/config, CI files) needs Jake. 
- Never commit secrets. No customer personal data in issues, PRs or memory files.
