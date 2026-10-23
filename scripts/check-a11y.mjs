// Runs the axe-core accessibility checker (WCAG 2.1 A and AA rules) on inventory pages at desktop and phone
// widths, and fails if anything is found. Same sign-in as check-screens.mjs (CHECK_EMAIL / CHECK_PASSWORD).
// Usage: node scripts/check-a11y.mjs [baseUrl] [path ...]
import { chromium } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const [base = "http://localhost:3000", ...paths] = process.argv.slice(2);
const pages = paths.length ? paths : ["/admin/inventory"];

const browser = await chromium.launch();
const context = await browser.newContext();
if (process.env.CHECK_EMAIL && process.env.CHECK_PASSWORD) {
  const login = await context.newPage();
  await login.goto(base + "/login?callbackUrl=/admin/inventory", { waitUntil: "networkidle" });
  await login.fill("input[type=email]", process.env.CHECK_EMAIL);
  await login.fill("input[type=password]", process.env.CHECK_PASSWORD);
  await login.click("button[type=submit]");
  await login.waitForURL((u) => u.pathname === "/admin/inventory", { timeout: 20000 });
  await login.close();
}

let failures = 0;
for (const path of pages) {
  for (const width of [1280, 375]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      // The Next.js dev-only indicator isn't part of the site.
      const r = await window.axe.run({ exclude: [["nextjs-portal"]] }, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
      return r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        count: v.nodes.length,
      }));
    });
    if (violations.length) {
      failures++;
      console.log(`✗ ${path} @ ${width}px`);
      for (const v of violations) console.log(`   ${v.impact} · ${v.id}: ${v.help} (${v.count}) → ${v.nodes.join(" | ")}`);
    } else {
      console.log(`✓ ${path} @ ${width}px`);
    }
    await page.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
