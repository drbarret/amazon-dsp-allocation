// Temporary UX-audit screenshot script (read-only task; not part of the app).
// Captures public screens of the local dev server for the UX redesign plan.
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3100";
const OUT = __dirname;

const pages = [
  { url: "/", name: "current-landing" },
  { url: "/login", name: "current-login" },
  { url: "/auth-error", name: "current-auth-error" },
  { url: "/forbidden", name: "current-forbidden" },
];

(async () => {
  const browser = await chromium.launch();
  for (const p of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + p.url, { waitUntil: "networkidle", timeout: 30000 });
    await page.screenshot({ path: path.join(OUT, p.name + "-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, p.name + "-mobile.png"), fullPage: true });
    console.log("captured", p.name);
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
