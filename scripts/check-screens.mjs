// Screenshots inventory pages at phone, tablet and desktop widths and fails if any page scrolls sideways,
// any form field is under 16px (iOS zoom), or any visible tap target is under 44px tall.
// Usage: start the app (npm run dev or npm start), then:
//   node scripts/check-screens.mjs [baseUrl] [path ...]
//   node scripts/check-screens.mjs http://localhost:3000 /admin/inventory /admin/inventory/products
// Screenshots go to ./screenshots/. First run: npx playwright install chromium
// Set CHECK_EMAIL and CHECK_PASSWORD (a local test manager) to sign in through /login first.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:3000", ...paths] = process.argv.slice(2);
const pages = paths.length ? paths : ["/admin/inventory"];
const widths = [375, 768, 1024, 1280];
mkdirSync("screenshots", { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext();
if (process.env.CHECK_EMAIL && process.env.CHECK_PASSWORD) {
  const login = await context.newPage();
  // Wait for the form to hydrate, or the submit does a plain page reload instead of signing in.
  await login.goto(base + "/login?callbackUrl=/admin/inventory", { waitUntil: "networkidle" });
  await login.fill("input[type=email]", process.env.CHECK_EMAIL);
  await login.fill("input[type=password]", process.env.CHECK_PASSWORD);
  await login.click("button[type=submit]");
  await login.waitForURL((u) => u.pathname === "/admin/inventory", { timeout: 20000 });
  await login.close();
}
let failures = 0;
for (const path of pages) {
  for (const width of widths) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + path, { waitUntil: "networkidle" });
    const r = await page.evaluate(() => {
      const visible = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
      const fields = [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]), select, textarea")].filter(visible);
      const targets = [...document.querySelectorAll("a, button, select, input:not([type=hidden])")].filter(visible)
        .filter((e) => !(e.tagName === "INPUT" && ["checkbox", "radio"].includes(e.type)));
      return {
        scrollWidth: document.documentElement.scrollWidth,
        smallFields: fields.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length,
        smallTargets: targets.filter((e) => e.getBoundingClientRect().height < 44)
          .map((e) => (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 30)),
      };
    });
    const name = `screenshots/${path.replace(/\W+/g, "_").replace(/^_|_$/g, "") || "root"}_${width}.png`;
    await page.screenshot({ path: name, fullPage: true });
    const problems = [];
    if (r.scrollWidth > width) problems.push(`page scrolls sideways (${r.scrollWidth}px wide)`);
    if (r.smallFields) problems.push(`${r.smallFields} form field(s) under 16px`);
    if (r.smallTargets.length) problems.push(`tap targets under 44px: ${r.smallTargets.join(", ")}`);
    console.log(`${problems.length ? "✗" : "✓"} ${path} @ ${width}px ${problems.join("; ")}  → ${name}`);
    failures += problems.length ? 1 : 0;
    await page.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
