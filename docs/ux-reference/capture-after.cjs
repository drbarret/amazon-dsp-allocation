// Captura "depois" das telas públicas + preview da navegação (Fatias 0 e 2).
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3100";
const OUT = path.join(__dirname, "shots");

const pages = [
  { url: "/", name: "after-landing" },
  { url: "/login", name: "after-login" },
  { url: "/nav-preview", name: "after-nav" },
];

(async () => {
  const browser = await chromium.launch();
  for (const p of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + p.url, { waitUntil: "networkidle", timeout: 60000 });
    await page.screenshot({ path: path.join(OUT, p.name + "-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, p.name + "-mobile.png"), fullPage: true });
    console.log("captured", p.name);

    if (p.name === "after-nav") {
      // abre a gaveta mobile e fotografa
      await page.click('button[aria-label="Abrir menu de navegação"]');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, "after-nav-mobile-drawer.png"), fullPage: true });
      console.log("captured after-nav-mobile-drawer");
    }
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
