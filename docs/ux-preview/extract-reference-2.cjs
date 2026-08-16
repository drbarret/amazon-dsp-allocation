// Extracao dirigida: sidebar, pills de status, KPI internals, badge de versao,
// comportamento mobile da referencia. Artefato isolado de prototipo.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "https://2u65rfunwtu6y.kimi.page";
const OUT_DIR = __dirname;
const SHOTS = path.join(OUT_DIR, "shots", "reference");

const FN = `(() => {
  const out = {};
  const info = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const g = (p) => s[p];
    return {
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === "string" ? el.className.slice(0, 160) : "",
      text: (el.textContent || "").trim().slice(0, 60),
      color: g("color"), bg: g("backgroundColor"),
      fontSize: g("fontSize"), fontWeight: g("fontWeight"), lineHeight: g("lineHeight"),
      radius: g("borderRadius"), border: g("border"), shadow: g("boxShadow"),
      padding: g("padding"), margin: g("margin"), height: g("height"), width: g("width"),
      gap: g("gap"), display: g("display")
    };
  };
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));

  // Sidebar: elemento fixo a esquerda escuro
  const aside = q("aside") || q("[class*=sidebar]") || q("[class*=Sidebar]");
  out.aside = info(aside);
  if (aside) {
    out.asideChildren = Array.from(aside.children).slice(0, 6).map(info);
    const brand = aside.querySelector("h1");
    out.sidebarBrand = info(brand);
    const sub = brand ? brand.parentElement.querySelector("p, span") : null;
    out.sidebarBrandSub = info(sub);
    const version = qa("aside *").find((e) => /v1\\.0|Sistema de Escala/i.test(e.textContent || "") && e.children.length === 0);
    out.sidebarVersion = info(version);
  }

  // Pills de status: spans pequenos com fundo colorido
  const candidates = qa("span, div, button").filter((e) => {
    const t = (e.textContent || "").trim();
    return /^(Sim|Passeio|Speed|Sem Escala|à confirmar|a confirmar|Pendente|Enviada|Ativo|Inativo)$/.test(t) && e.children.length <= 1;
  });
  out.statusPills = candidates.slice(0, 12).map(info);

  // KPI internals
  const kpi = qa("[class*=card]").find((c) => /Motoristas Ativos/.test(c.textContent || ""));
  if (kpi) {
    out.kpiCard = info(kpi);
    const label = Array.from(kpi.querySelectorAll("*")).find((e) => (e.textContent || "").trim() === "Motoristas Ativos");
    const value = Array.from(kpi.querySelectorAll("*")).find((e) => /^\\d+$/.test((e.textContent || "").trim()) && e.children.length === 0);
    const hint = Array.from(kpi.querySelectorAll("*")).find((e) => /cadastrados no sistema/.test(e.textContent || "") && e.children.length === 0);
    out.kpiLabel = info(label);
    out.kpiValue = info(value);
    out.kpiHint = info(hint);
    const icon = kpi.querySelector("svg");
    out.kpiIcon = icon ? { color: getComputedStyle(icon).color, w: icon.getBoundingClientRect().width, h: icon.getBoundingClientRect().height, cls: icon.getAttribute("class") } : null;
  }

  // Week row (dashboard)
  const weekRow = qa("div").find((e) => /Semana 33/.test(e.textContent || "") && /Pendente/.test(e.textContent || "") && e.querySelectorAll("*").length < 20);
  out.weekRow = info(weekRow);

  // Layout shell
  const shell = aside ? aside.parentElement : null;
  out.shell = info(shell);
  const main = q("main");
  out.main = info(main);
  const mainInner = main ? main.firstElementChild : null;
  out.mainInner = info(mainInner);
  const pageTitle = q("main h1, main h2");
  out.pageTitle = info(pageTitle);
  const pageDesc = pageTitle ? pageTitle.nextElementSibling : null;
  out.pageDesc = info(pageDesc);

  // Mobile: hamburguer visivel?
  out.viewport = { w: innerWidth, h: innerHeight };
  const burger = qa("button").find((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.width < 60 && r.height < 60 && b.querySelector("svg") && r.left < 400 && r.top < 100;
  });
  out.burger = info(burger);
  out.asideVisible = aside ? getComputedStyle(aside).display !== "none" && aside.getBoundingClientRect().width > 0 : null;
  out.asideRect = aside ? aside.getBoundingClientRect().toJSON() : null;

  return out;
})()`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const result = { extractedAt: new Date().toISOString(), base: BASE, desktop: {}, mobile: {} };

  // Desktop: home + alocacao (pills) + motoristas (tabela com dados? nao — vazio) + vagas
  for (const route of ["/", "/alocacao", "/vagas", "/performance"]) {
    const slug = route === "/" ? "home" : route.slice(1);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 }).catch((e) => console.log("NAV-WARN", route, e.message));
    await page.waitForTimeout(1200);
    result.desktop[slug] = await page.evaluate(FN);
    await page.close();
  }

  // Mobile: home — sidebar vira o que?
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await m.waitForTimeout(1000);
  result.mobile.home = await m.evaluate(FN);
  await m.screenshot({ path: path.join(SHOTS, "home-mobile-2.png"), fullPage: true });
  // tenta abrir o menu mobile se houver botao
  const clicked = await m.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find((x) => {
      const r = x.getBoundingClientRect();
      return r.width > 0 && r.top < 80 && x.querySelector("svg");
    });
    if (b) { b.click(); return true; }
    return false;
  })()`);
  await m.waitForTimeout(700);
  result.mobile.menuOpened = clicked;
  await m.screenshot({ path: path.join(SHOTS, "home-mobile-menu.png"), fullPage: true });
  await m.close();

  fs.writeFileSync(path.join(OUT_DIR, "reference-tokens-2.json"), JSON.stringify(result, null, 2));
  console.log("targeted extraction written; menuOpened =", clicked);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
