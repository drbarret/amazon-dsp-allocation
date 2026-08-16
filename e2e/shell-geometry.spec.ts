/**
 * Shell geometry regression tests (real browser, real layout).
 *
 * Why this exists: the mobile shell shipped to production rendering the top
 * bar as a ~208px side column (flex-row parent), squeezing <main> into
 * ~182px with horizontal overflow. Every existing UI test was semantic
 * (roles, aria-current, class presence) — none measured layout, so the bug
 * passed. These tests assert GEOMETRY, not classes:
 *
 *   - mobile (<1024px): top bar spans the FULL viewport width, sits at the
 *     top (y=0, short height), <main> starts below it at x=0 and uses the
 *     full width, and document has NO horizontal overflow;
 *   - desktop (>=1024px): sidebar is a 256px fixed column, <main> sits to
 *     its right, no horizontal overflow.
 *
 * jsdom does not compute layout, so this MUST stay a Playwright test.
 *
 * Requires: DATABASE_URL + AUTH_SECRET (disposable SUPERVISOR user, forged
 * Auth.js JWT). Opt out explicitly with SKIP_E2E_TESTS=1 (CI without DB).
 */
import { test, expect, type Browser } from "playwright/test";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const SKIP_E2E = (process.env.SKIP_E2E_TESTS ?? "").trim() === "1";
const AUTH_SECRET = process.env.AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

const UID = "e2e-shell-geometry-temp";
const TCID = "e2e-shell-geometry-tc";
const WEEKID = "e2e-shell-geometry-week";
const EMAIL = "e2e-shell-geometry@instalog.com.br";
const COOKIE = "authjs.session-token";

async function forgeJWT(payload: Record<string, unknown>): Promise<string> {
  const enc = "A256CBC-HS512";
  const key = await hkdf(
    "sha256",
    AUTH_SECRET!,
    new TextEncoder().encode(COOKIE),
    `Auth.js Generated Encryption Key (${COOKIE})`,
    64,
  );
  const kid = await calculateJwkThumbprint(
    { kty: "oct", k: base64url.encode(key) },
    "sha512",
  );
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc, kid })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setJti(randomUUID())
    .encrypt(key);
}

type Geometry = {
  vw: number;
  docScrollW: number;
  horizontalOverflow: boolean;
  topBar: { x: number; y: number; w: number; h: number } | null;
  topBarVisible: boolean;
  aside: { x: number; y: number; w: number; h: number } | null;
  asideVisible: boolean;
  main: { x: number; y: number; w: number; h: number } | null;
};

type TableGeometry = {
  tableCount: number;
  tables: {
    index: number;
    scrollW: number;
    clientW: number;
    overflowsContainer: boolean;
    containerScrollW: number;
    containerClientW: number;
    containerHasHScroll: boolean;
    lastCellRect: { right: number; viewportRight: number } | null;
    lastCellClipped: boolean;
  }[];
};

async function measure(
  browser: Browser,
  path: string,
  width: number,
  height: number,
  token: string,
): Promise<Geometry> {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([
    {
      name: COOKIE,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 30_000 });
    return await page.evaluate(() => {
      const rect = (el: Element | null) =>
        el
          ? {
              x: el.getBoundingClientRect().x,
              y: el.getBoundingClientRect().y,
              w: el.getBoundingClientRect().width,
              h: el.getBoundingClientRect().height,
            }
          : null;
      const topBar = document.querySelector("div.sticky.top-0.z-40.lg\\:hidden");
      const aside = document.querySelector("aside");
      const main = document.querySelector("main");
      const vw = document.documentElement.clientWidth;
      const docScrollW = Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      );
      return {
        vw,
        docScrollW,
        horizontalOverflow: docScrollW > vw,
        topBar: rect(topBar),
        topBarVisible: topBar ? getComputedStyle(topBar).display !== "none" : false,
        aside: rect(aside),
        asideVisible: aside ? getComputedStyle(aside).display !== "none" : false,
        main: rect(main),
      };
    });
  } finally {
    await context.close();
  }
}

async function measureTables(
  browser: Browser,
  path: string,
  width: number,
  height: number,
  token: string,
): Promise<TableGeometry> {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([
    {
      name: COOKIE,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 30_000 });
    return await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const tables = Array.from(document.querySelectorAll("table"));
      return {
        tableCount: tables.length,
        tables: tables.map((table, index) => {
          const container = table.closest("div.overflow-x-auto");
          const containerEl = container ?? table.parentElement;
          const containerScrollW = containerEl?.scrollWidth ?? 0;
          const containerClientW = containerEl?.clientWidth ?? 0;

          // Check if the last cell of the first data row is clipped
          const firstRow = table.querySelector("tbody tr");
          let lastCellRect: { right: number; viewportRight: number } | null = null;
          let lastCellClipped = false;
          if (firstRow) {
            const cells = firstRow.querySelectorAll("td");
            const lastCell = cells[cells.length - 1];
            if (lastCell) {
              const r = lastCell.getBoundingClientRect();
              lastCellRect = { right: r.right, viewportRight: vw };
              // Cell is clipped if it extends beyond the viewport
              lastCellClipped = r.right > vw;
            }
          }

          return {
            index,
            scrollW: table.scrollWidth,
            clientW: table.clientWidth,
            overflowsContainer: table.scrollWidth > table.clientWidth,
            containerScrollW,
            containerClientW,
            containerHasHScroll: containerScrollW > containerClientW,
            lastCellRect,
            lastCellClipped,
          };
        }),
      };
    });
  } finally {
    await context.close();
  }
}

test.describe("shell geometry (protected screens)", () => {
  test.skip(SKIP_E2E, "SKIP_E2E_TESTS=1 set — explicit opt-out (CI without DB)");

  let client: pg.Client;
  let token: string;

  test.beforeAll(async () => {
    if (!AUTH_SECRET || !DATABASE_URL) {
      throw new Error(
        "E2E geometry tests require AUTH_SECRET and DATABASE_URL. " +
          "Set them, or opt out explicitly with SKIP_E2E_TESTS=1.",
      );
    }
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`SELECT 1`); // fail high if DB unreachable

    await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [EMAIL]);
    await client.query(`DELETE FROM "users" WHERE id = $1`, [UID]);
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Shell', 'SUPERVISOR', true, now(), now())`,
      [UID, EMAIL],
    );
    await client.query(
      `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'SUPERVISOR', 'ACTIVE', now(), now())`,
      [EMAIL],
    );
    token = await forgeJWT({
      id: UID,
      email: EMAIL,
      name: "E2E Shell",
      role: "SUPERVISOR",
      active: true,
      roleLastFetched: Date.now(),
    });
  });

  test.afterAll(async () => {
    if (client) {
      await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [EMAIL]);
      await client.query(`DELETE FROM "users" WHERE id = $1`, [UID]);
      await client.end();
    }
  });

  for (const path of ["/dashboard", "/drivers"]) {
    test(`${path} @390: top bar spans full width, main below, no h-overflow`, async ({
      browser,
    }) => {
      const g = await measure(browser, path, 390, 844, token);

      // Top bar: full viewport width, at the top, short (a bar, not a column)
      expect(g.topBarVisible, "mobile top bar must be visible").toBe(true);
      expect(g.topBar!.x).toBe(0);
      expect(g.topBar!.y).toBe(0);
      expect(g.topBar!.w).toBe(g.vw);
      expect(g.topBar!.h).toBeLessThanOrEqual(80);

      // Main: starts below the bar, at x=0, using full width
      expect(g.main!.x).toBe(0);
      expect(g.main!.y).toBeGreaterThanOrEqual(g.topBar!.h - 1);
      expect(g.main!.w).toBe(g.vw);

      // No horizontal overflow anywhere
      expect(g.horizontalOverflow,
        `horizontal overflow: scrollWidth ${g.docScrollW} > viewport ${g.vw}`,
      ).toBe(false);

      // Desktop sidebar must NOT be visible at this width
      expect(g.asideVisible).toBe(false);
    });

    test(`${path} @1024: sidebar 256px column, main to its right, no h-overflow`, async ({
      browser,
    }) => {
      const g = await measure(browser, path, 1024, 844, token);

      expect(g.asideVisible, "desktop sidebar must be visible").toBe(true);
      expect(g.aside!.x).toBe(0);
      expect(g.aside!.w).toBe(256);

      expect(g.main!.x).toBe(256);
      expect(g.main!.w).toBe(g.vw - 256);

      expect(g.topBarVisible, "mobile top bar must be hidden on desktop").toBe(false);
      expect(g.horizontalOverflow).toBe(false);
    });
  }

  test("/dashboard @768 (between breakpoints): bar full width, no h-overflow", async ({
    browser,
  }) => {
    const g = await measure(browser, "/dashboard", 768, 844, token);
    expect(g.topBar!.w).toBe(g.vw);
    expect(g.main!.x).toBe(0);
    expect(g.main!.w).toBe(g.vw);
    expect(g.horizontalOverflow).toBe(false);
    expect(g.asideVisible).toBe(false);
  });
});

test.describe("table geometry (data tables)", () => {
  test.skip(SKIP_E2E, "SKIP_E2E_TESTS=1 set — explicit opt-out (CI without DB)");

  let client: pg.Client;
  let token: string;

  test.beforeAll(async () => {
    if (!AUTH_SECRET || !DATABASE_URL) {
      throw new Error(
        "E2E geometry tests require AUTH_SECRET and DATABASE_URL. " +
          "Set them, or opt out explicitly with SKIP_E2E_TESTS=1.",
      );
    }
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`SELECT 1`);

    await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [EMAIL]);
    await client.query(`DELETE FROM "users" WHERE id = $1`, [UID]);
    await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);
    // A transport company is required so /dispatch renders its tables instead
    // of the "no transport company" empty state.
    await client.query(
      `INSERT INTO "transport_companies" ("id", "name", "createdAt", "updatedAt")
       VALUES ($1, 'E2E Shell Transport', now(), now())`,
      [TCID],
    );
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Shell', 'SUPERVISOR', true, $3, now(), now())`,
      [UID, EMAIL, TCID],
    );
    await client.query(
      `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'SUPERVISOR', 'ACTIVE', now(), now())`,
      [EMAIL],
    );
    // One DispatchWeek so /dispatch renders the vacancies DataTable (with its
    // own empty state) instead of the "no week registered" empty state.
    await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
    await client.query(
      `INSERT INTO "dispatch_weeks"
         ("id", "transportCompanyId", "weekKey", "year", "weekNumber", "startDate", "endDate", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'WK-E2E', 2026, 33, '2026-08-16', '2026-08-22', 'PLANNING', now(), now())`,
      [WEEKID, TCID],
    );
    token = await forgeJWT({
      id: UID,
      email: EMAIL,
      name: "E2E Shell",
      role: "SUPERVISOR",
      active: true,
      roleLastFetched: Date.now(),
    });
  });

  test.afterAll(async () => {
    if (client) {
      await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [EMAIL]);
      await client.query(`DELETE FROM "users" WHERE id = $1`, [UID]);
      await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
      await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);
      await client.end();
    }
  });

  for (const path of ["/drivers", "/cnh", "/dispatch", "/behavior"]) {
    test(`${path} @390: table fits viewport, no page h-overflow, container scrolls explicitly`, async ({
      browser,
    }) => {
      const g = await measure(browser, path, 390, 844, token);
      expect(g.horizontalOverflow).toBe(false);

      const tg = await measureTables(browser, path, 390, 844, token);
      expect(tg.tableCount).toBeGreaterThan(0);

      for (const t of tg.tables) {
        // If the table is wider than its container, the container must
        // scroll horizontally (explicit, not accidental page overflow).
        if (t.overflowsContainer) {
          expect(
            t.containerHasHScroll,
            `table ${t.index}: overflows container but container has no h-scroll ` +
              `(table scrollW=${t.scrollW} > clientW=${t.clientW}, ` +
              `container scrollW=${t.containerScrollW} > clientW=${t.containerClientW})`,
          ).toBe(true);
        }
      }
    });

    test(`${path} @1440: table fits viewport, no page h-overflow, no clipped last column`, async ({
      browser,
    }) => {
      const g = await measure(browser, path, 1440, 900, token);
      expect(g.horizontalOverflow).toBe(false);

      const tg = await measureTables(browser, path, 1440, 900, token);
      expect(tg.tableCount).toBeGreaterThan(0);

      for (const t of tg.tables) {
        expect(
          t.lastCellClipped,
          `table ${t.index}: last cell clipped (right=${t.lastCellRect?.right} > vw=${t.lastCellRect?.viewportRight})`,
        ).toBe(false);
      }
    });
  }
});
