// Captura screenshots das telas publicas do app real (next dev).
// Uso: node scripts/capture-public-screens.cjs <outDir> <port>
// Artefato de documentacao — nao faz parte do app.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = process.argv[2];
const PORT = process.argv[3] || "3000";
const BASE = `http://localhost:${PORT}`;
const PAGES = [
  ["landing", "/"],
  ["login", "/login"],
  ["login-deactivated", "/login?error=deactivated"],
  ["login-unauthorized", "/login?error=unauthorized"],
  ["auth-error", "/auth-error"],
  ["forbidden", "/forbidden"],
];

(async () => {
  if (!OUT) {
    console.error("uso: node scripts/capture-public-screens.cjs <outDir> <port>");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, route] of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, name + "-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, name + "-mobile.png"), fullPage: true });
    console.log("captured", name);
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
