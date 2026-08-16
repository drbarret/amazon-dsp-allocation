// Captura screenshots do prototipo estatico (desktop 1440x900, mobile 390x844).
// Artefato isolado — nao faz parte do app.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.join(__dirname, "shots");
const PAGES = ["index", "dispatch", "drivers", "cnh", "users", "behavior", "login"];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const name of PAGES) {
    const fileUrl = "file:///" + path.join(__dirname, name + ".html").replace(/\\/g, "/");
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(fileUrl, { waitUntil: "load", timeout: 30000 });
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
