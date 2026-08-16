// Extrai computed styles reais da referencia (https://2u65rfunwtu6y.kimi.page)
// e captura screenshots. Artefato isolado de prototipo — nao faz parte do app.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "https://2u65rfunwtu6y.kimi.page";
const OUT_DIR = __dirname;
const SHOTS = path.join(OUT_DIR, "shots", "reference");

const PAGES = ["/", "/motoristas", "/disponibilidades", "/vagas", "/performance", "/alocacao", "/logs"];

const EXTRACT_FN = `(() => {
  const out = { url: location.pathname, title: document.title };
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const pick = (s, props) => {
    if (!s) return null;
    const o = {};
    for (const p of props) o[p] = s[p];
    return o;
  };
  const PROPS = [
    "color", "backgroundColor", "fontFamily", "fontSize", "fontWeight",
    "lineHeight", "letterSpacing", "textTransform",
    "borderRadius", "border", "borderColor", "borderWidth", "borderStyle",
    "boxShadow", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "height", "minHeight", "maxWidth", "gap", "display", "alignItems", "justifyContent",
    "textDecorationLine", "opacity"
  ];
  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));
  const nodeInfo = (el) => {
    if (!el) return null;
    const s = cs(el);
    return {
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === "string" ? el.className.slice(0, 200) : "",
      text: (el.textContent || "").trim().slice(0, 80),
      style: pick(s, PROPS)
    };
  };

  out.viewport = { w: innerWidth, h: innerHeight };
  out.body = nodeInfo(document.body);
  out.main = nodeInfo(q("main"));

  // Cabecalho
  const header = q("header") || q("nav") || q("[class*=header]") || q("[class*=Header]");
  out.header = nodeInfo(header);
  if (header) {
    out.headerInner = nodeInfo(header.firstElementChild);
    out.brand = nodeInfo(header.querySelector("a, [class*=logo], [class*=brand], [class*=Logo], [class*=Brand]"));
    out.headerLinks = qa("header a, nav a").slice(0, 12).map(nodeInfo);
    out.headerBadge = nodeInfo(header.querySelector("[class*=badge], [class*=Badge], span"));
  }

  // Tipografia
  out.h1 = nodeInfo(q("h1"));
  out.h2 = nodeInfo(q("h2"));
  out.h3 = nodeInfo(q("h3"));

  // Botoes
  out.buttons = qa("button, a[class*=btn], [class*=button], [class*=Button]").slice(0, 10).map(nodeInfo);

  // Pilulas / badges / chips de status
  const pillSel = "[class*=badge], [class*=Badge], [class*=pill], [class*=Pill], [class*=chip], [class*=Chip], [class*=status], [class*=Status], [class*=tag], [class*=Tag]";
  out.pills = qa(pillSel).slice(0, 20).map(nodeInfo);

  // Cartoes (KPI e genericos)
  const cardSel = "[class*=card], [class*=Card]";
  out.cards = qa(cardSel).slice(0, 12).map(nodeInfo);

  // Tabela
  const table = q("table");
  out.table = nodeInfo(table);
  if (table) {
    out.tableHeadCell = nodeInfo(table.querySelector("thead th, thead td"));
    out.tableBodyCell = nodeInfo(table.querySelector("tbody td"));
    out.tableRow = nodeInfo(table.querySelector("tbody tr"));
  }

  // Inputs e selects
  out.input = nodeInfo(q("input"));
  out.select = nodeInfo(q("select"));

  // Links genericos
  out.link = nodeInfo(q("main a, a"));

  // Variaveis CSS do :root
  const rootVars = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules) {
      if (rule.selectorText === ":root" && rule.style) {
        for (let i = 0; i < rule.style.length; i++) {
          const name = rule.style[i];
          if (name.startsWith("--")) rootVars[name] = rule.style.getPropertyValue(name).trim();
        }
      }
    }
  }
  out.rootVars = rootVars;

  // Fontes carregadas
  out.fonts = Array.from(document.fonts).map((f) => f.family + " " + f.weight + " " + f.status);

  return out;
})()`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const inventory = { extractedAt: new Date().toISOString(), base: BASE, pages: {} };

  for (const route of PAGES) {
    const slug = route === "/" ? "home" : route.slice(1);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
    } catch (e) {
      console.log("NAV-WARN", route, e.message);
    }
    await page.waitForTimeout(800);
    try {
      inventory.pages[slug] = await page.evaluate(EXTRACT_FN);
    } catch (e) {
      inventory.pages[slug] = { error: String(e) };
    }
    await page.screenshot({ path: path.join(SHOTS, slug + "-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, slug + "-mobile.png"), fullPage: true });
    console.log("captured", slug);
    await page.close();
  }

  // Breakpoints: largura onde o menu horizontal deixa de caber / muda de layout
  const bp = await browser.newPage();
  await bp.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  const widths = [1280, 1024, 900, 768, 700, 640, 600, 480, 390, 360];
  inventory.breakpointProbe = [];
  for (const w of widths) {
    await bp.setViewportSize({ width: w, height: 900 });
    await bp.waitForTimeout(300);
    const probe = await bp.evaluate(`(() => {
      const nav = document.querySelector("header nav, nav");
      const burger = document.querySelector("[class*=burger], [class*=Burger], [class*=menu-btn], [class*=Menu], button[aria-label*=menu], button[aria-label*=Menu]");
      const navVisible = nav ? getComputedStyle(nav).display !== "none" : null;
      const navScroll = nav ? nav.scrollWidth > nav.clientWidth : null;
      return { width: innerWidth, navDisplay: nav ? getComputedStyle(nav).display : null, navVisible, navOverflows: navScroll, burgerVisible: burger ? getComputedStyle(burger).display !== "none" : null };
    })()`);
    inventory.breakpointProbe.push(probe);
  }
  await bp.close();

  fs.writeFileSync(path.join(OUT_DIR, "reference-tokens.json"), JSON.stringify(inventory, null, 2));
  console.log("inventory written");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
