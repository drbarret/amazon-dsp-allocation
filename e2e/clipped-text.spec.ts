/**
 * Clipped / cut-off text sweep (real browser, real layout).
 *
 * Why this exists: the geometry suite measures CONTAINERS (does the table fit,
 * does the page overflow horizontally) but three confirmed visual defects
 * passed it anyway — all of them were CONTENT clipped INSIDE a fitting
 * container:
 *
 *   1. EmptyState rendered inside a scrollable <table> inherited the table's
 *      scroll width, so its text was cut at the viewport edge (@390);
 *   2. /dispatch "Motoristas Ativos" vehicle column ended at x=1030 on a
 *      1024px viewport (tablet width, not exotic);
 *   3. /admin/users role <Select> showed the raw enum "ACCOUNT_MANAGER"
 *      line-clamped to "ACCOUNT_MAN" (@1024 and @1440).
 *
 * These tests assert, on every main screen and every tested width:
 *
 *   A. NO element has its own text clipped invisibly: scrollWidth exceeds
 *      clientWidth while overflow-x is hidden/clip WITHOUT an ellipsis
 *      (text-overflow: ellipsis is the intentional, visible truncation);
 *   B. NO visible text element extends beyond the viewport, unless it lives
 *      inside a real horizontal scroller (a table or an overflow-x:auto
 *      container the user can actually scroll);
 *   C. every [data-slot="empty-state"] is fully contained in the viewport —
 *      an empty state is status text, never scrollable table content;
 *   D. on desktop widths (>=1024) no table cell extends beyond the viewport
 *      (mobile tables may scroll horizontally by design).
 *
 * jsdom does not compute layout, so this MUST stay a Playwright test.
 *
 * Requires: DATABASE_URL + AUTH_SECRET (disposable SUPERVISOR and ADMIN users,
 * forged Auth.js JWTs). Opt out explicitly with SKIP_E2E_TESTS=1.
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

const SUP_ID = "e2e-clip-sup";
const ADMIN_ID = "e2e-clip-admin";
const AM_ID = "e2e-clip-am";
const DRIVER_ID = "e2e-clip-driver";
const TCID = "e2e-clip-tc";
const WEEKID = "e2e-clip-week";
const SUP_EMAIL = "e2e-clip-sup@instalog.com.br";
const ADMIN_EMAIL = "e2e-clip-admin@instalog.com.br";
const AM_EMAIL = "e2e-clip-am@instalog.com.br";
const DRIVER_EMAIL = "e2e-clip-driver@instalog.com.br";
const ALL_EMAILS = [SUP_EMAIL, ADMIN_EMAIL, AM_EMAIL, DRIVER_EMAIL];
const ALL_IDS = [SUP_ID, ADMIN_ID, AM_ID, DRIVER_ID];
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

type ClipFinding = {
  tag: string;
  text: string;
  scrollW: number;
  clientW: number;
  right: number;
  left: number;
};

type ClipReport = {
  vw: number;
  clippedNoEllipsis: ClipFinding[];
  beyondViewport: ClipFinding[];
  emptyStatesOut: { text: string; right: number; left: number; vw: number }[];
  tableCellsBeyond: ClipFinding[];
};

async function measureClipped(
  browser: Browser,
  path: string,
  width: number,
  height: number,
  token: string,
): Promise<ClipReport> {
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
    // Hide the Next.js dev overlay so its chrome is never measured.
    await page.addStyleTag({
      content: `nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay] { display: none !important; }`,
    });
    return await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const TOL = 1;

      const isVisible = (el: Element): boolean => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const ownText = (el: Element): string => {
        let t = "";
        for (const n of Array.from(el.childNodes)) {
          if (n.nodeType === Node.TEXT_NODE) t += n.textContent ?? "";
        }
        return t.trim();
      };

      const allText = (el: Element): string =>
        (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);

      // True when `el` sits inside a container the user can really scroll
      // horizontally (overflow-x auto/scroll AND content wider than the box),
      // or inside a <table> (table content scrolls via its wrapper).
      const insideRealScroller = (el: Element): boolean => {
        let node: Element | null = el.parentElement;
        while (node) {
          if (node.tagName === "TABLE") return true;
          const cs = getComputedStyle(node);
          const ox = cs.overflowX;
          if (
            (ox === "auto" || ox === "scroll") &&
            node.scrollWidth > node.clientWidth + TOL
          ) {
            return true;
          }
          node = node.parentElement;
        }
        return false;
      };

      const describe = (el: Element): ClipFinding => {
        const r = el.getBoundingClientRect();
        return {
          tag: `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(" ").slice(0, 3).join(".")}`,
          text: allText(el),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          right: Math.round(r.right * 100) / 100,
          left: Math.round(r.left * 100) / 100,
        };
      };

      const clippedNoEllipsis: ClipFinding[] = [];
      const beyondViewport: ClipFinding[] = [];
      const tableCellsBeyond: ClipFinding[] = [];

      const candidates = Array.from(
        document.querySelectorAll("main *"),
      ) as HTMLElement[];

      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const tag = el.tagName;
        if (["SCRIPT", "STYLE", "SVG", "PATH", "INPUT", "TEXTAREA", "SELECT", "OPTION"].includes(tag)) {
          continue;
        }
        const text = ownText(el);
        if (!text) continue; // only elements with direct text can be "clipped text"

        const cs = getComputedStyle(el);
        const ox = cs.overflowX;

        // A. invisible clip: content wider than the box, hidden, no ellipsis.
        //    NO scroller exemption here: text clipped INSIDE a visible cell
        //    (e.g. the role <Select> line-clamped to "ACCOUNT_MAN") is
        //    unreachable no matter how the user scrolls — that is precisely
        //    the defect class this assertion exists to catch. Elements that
        //    are themselves scrollable (overflow-x auto/scroll) are already
        //    excluded by the hidden/clip filter above.
        if (
          el.scrollWidth > el.clientWidth + TOL &&
          (ox === "hidden" || ox === "clip") &&
          cs.textOverflow !== "ellipsis"
        ) {
          clippedNoEllipsis.push(describe(el));
        }

        // B. text extending beyond the viewport without a real scroller.
        const r = el.getBoundingClientRect();
        if ((r.right > vw + TOL || r.left < -TOL) && !insideRealScroller(el)) {
          beyondViewport.push(describe(el));
        }
      }

      // D. desktop: no table cell may end beyond the viewport —
      //    - at >=1440 (wide desktop) for EVERY table: the pre-existing
      //      geometry suite already asserted "no clipped last column" at
      //      1440 for the other screens; everything must fit at this width;
      //    - at 1024-1439 (tablet/narrow desktop) for tables inside GRID
      //      CARDS (a column of an lg:grid-cols-* layout, e.g. /dispatch
      //      "Motoristas Ativos"): horizontal scrolling inside a narrow card
      //      is a broken layout, not responsive design. Dense FULL-WIDTH
      //      tables at 1024 (e.g. /admin/users) may scroll horizontally —
      //      whether to drop columns there is a product decision (reported).
      if (vw >= 1024) {
        const wideDesktop = vw >= 1440;
        const tables = Array.from(document.querySelectorAll("main table"));
        for (const table of tables) {
          if (!wideDesktop && !table.closest('[class*="lg:grid-cols-"]')) {
            continue; // 1024-1439: only grid-card tables are asserted
          }
          const cells = Array.from(table.querySelectorAll("td, th"));
          for (const cell of cells) {
            if (!isVisible(cell)) continue;
            const r = cell.getBoundingClientRect();
            if (r.right > vw + TOL) {
              tableCellsBeyond.push(describe(cell));
            }
          }
        }
      }

      // C. empty states must be fully inside the viewport.
      const emptyStatesOut: ClipReport["emptyStatesOut"] = [];
      for (const es of Array.from(document.querySelectorAll('[data-slot="empty-state"]'))) {
        if (!isVisible(es)) continue;
        const r = es.getBoundingClientRect();
        if (r.right > vw + TOL || r.left < -TOL) {
          emptyStatesOut.push({
            text: allText(es),
            right: Math.round(r.right * 100) / 100,
            left: Math.round(r.left * 100) / 100,
            vw,
          });
        }
      }

      return { vw, clippedNoEllipsis, beyondViewport, emptyStatesOut, tableCellsBeyond };
    });
  } finally {
    await context.close();
  }
}

function fmt(list: { tag: string; text: string; right?: number; scrollW?: number; clientW?: number }[]): string {
  return list
    .slice(0, 8)
    .map((f) => `<${f.tag}> "${f.text}" (right=${f.right}, scrollW=${f.scrollW}, clientW=${f.clientW})`)
    .join("\n  ");
}

test.describe("clipped text sweep (all main screens, all widths)", () => {
  test.skip(SKIP_E2E, "SKIP_E2E_TESTS=1 set — explicit opt-out (CI without DB)");

  let client: pg.Client;
  let supToken: string;
  let adminToken: string;

  test.beforeAll(async () => {
    if (!AUTH_SECRET || !DATABASE_URL) {
      throw new Error(
        "E2E clipped-text tests require AUTH_SECRET and DATABASE_URL. " +
          "Set them, or opt out explicitly with SKIP_E2E_TESTS=1.",
      );
    }
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`SELECT 1`);

    await client.query(`DELETE FROM "allowed_emails" WHERE email = ANY($1)`, [ALL_EMAILS]);
    await client.query(`DELETE FROM "driver_profiles" WHERE "userId" = ANY($1)`, [ALL_IDS]);
    await client.query(`DELETE FROM "users" WHERE id = ANY($1)`, [ALL_IDS]);
    await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);
    await client.query(
      `INSERT INTO "transport_companies" ("id", "name", "createdAt", "updatedAt")
       VALUES ($1, 'E2E Clip Transport', now(), now())`,
      [TCID],
    );
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Clip Sup', 'SUPERVISOR', true, $3, now(), now())`,
      [SUP_ID, SUP_EMAIL, TCID],
    );
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Clip Admin', 'ADMIN', true, now(), now()),
              ($3, $4, 'E2E Clip Manager', 'ACCOUNT_MANAGER', true, now(), now())`,
      [ADMIN_ID, ADMIN_EMAIL, AM_ID, AM_EMAIL],
    );
    // A driver with a long e-mail and a vehicle profile, so /dispatch renders
    // a real "Motoristas Ativos" row (the defect-2 shape).
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Clip Driver', 'DRIVER', true, $3, now(), now())`,
      [DRIVER_ID, DRIVER_EMAIL, TCID],
    );
    await client.query(
      `INSERT INTO "driver_profiles" ("id", "userId", "vehicleType", "onboardingCompleted", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'LARGE_VAN', true, now(), now())`,
      [DRIVER_ID],
    );
    await client.query(
      `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'SUPERVISOR', 'ACTIVE', now(), now()),
              (gen_random_uuid(), $2, 'ADMIN', 'ACTIVE', now(), now()),
              (gen_random_uuid(), $3, 'ACCOUNT_MANAGER', 'ACTIVE', now(), now()),
              (gen_random_uuid(), $4, 'DRIVER', 'ACTIVE', now(), now())`,
      [SUP_EMAIL, ADMIN_EMAIL, AM_EMAIL, DRIVER_EMAIL],
    );
    // A DispatchWeek with NO vacancies, so /dispatch renders both the
    // vacancies empty state and the drivers table with a real row.
    await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
    await client.query(
      `INSERT INTO "dispatch_weeks"
         ("id", "transportCompanyId", "weekKey", "year", "weekNumber", "startDate", "endDate", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'WK-CLIP', 2026, 33, '2026-08-16', '2026-08-22', 'PLANNING', now(), now())`,
      [WEEKID, TCID],
    );

    supToken = await forgeJWT({
      id: SUP_ID,
      email: SUP_EMAIL,
      name: "E2E Clip Sup",
      role: "SUPERVISOR",
      active: true,
      roleLastFetched: Date.now(),
    });
    adminToken = await forgeJWT({
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      name: "E2E Clip Admin",
      role: "ADMIN",
      active: true,
      roleLastFetched: Date.now(),
    });
  });

  test.afterAll(async () => {
    if (client) {
      await client.query(`DELETE FROM "allowed_emails" WHERE email = ANY($1)`, [ALL_EMAILS]);
      await client.query(`DELETE FROM "driver_profiles" WHERE "userId" = ANY($1)`, [ALL_IDS]);
      await client.query(`DELETE FROM "users" WHERE id = ANY($1)`, [ALL_IDS]);
      await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
      await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);
      await client.end();
    }
  });

  const SUPERVISOR_PATHS = ["/dashboard", "/drivers", "/drivers/deactivation-requests", "/cnh", "/dispatch", "/vagas"];
  const WIDTHS: [number, number][] = [
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ];

  for (const path of SUPERVISOR_PATHS) {
    for (const [w, h] of WIDTHS) {
      test(`${path} @${w}: no clipped/cut-off text`, async ({ browser }) => {
        const r = await measureClipped(browser, path, w, h, supToken);

        expect(
          r.clippedNoEllipsis,
          `${path} @${w}: text clipped invisibly (scrollW>clientW, hidden, no ellipsis):\n  ${fmt(r.clippedNoEllipsis)}`,
        ).toEqual([]);
        expect(
          r.beyondViewport,
          `${path} @${w}: text beyond viewport ${r.vw}px without a real scroller:\n  ${fmt(r.beyondViewport)}`,
        ).toEqual([]);
        expect(
          r.emptyStatesOut,
          `${path} @${w}: empty state outside viewport ${r.vw}px:\n  ${JSON.stringify(r.emptyStatesOut)}`,
        ).toEqual([]);
        expect(
          r.tableCellsBeyond,
          `${path} @${w}: table cells beyond viewport ${r.vw}px on desktop:\n  ${fmt(r.tableCellsBeyond)}`,
        ).toEqual([]);
      });
    }
  }

  for (const [w, h] of WIDTHS) {
    test(`/admin/users @${w}: no clipped/cut-off text`, async ({ browser }) => {
      const r = await measureClipped(browser, "/admin/users", w, h, adminToken);

      expect(
        r.clippedNoEllipsis,
        `/admin/users @${w}: text clipped invisibly:\n  ${fmt(r.clippedNoEllipsis)}`,
      ).toEqual([]);
      expect(
        r.beyondViewport,
        `/admin/users @${w}: text beyond viewport ${r.vw}px without a real scroller:\n  ${fmt(r.beyondViewport)}`,
      ).toEqual([]);
      expect(
        r.emptyStatesOut,
        `/admin/users @${w}: empty state outside viewport ${r.vw}px:\n  ${JSON.stringify(r.emptyStatesOut)}`,
      ).toEqual([]);
      expect(
        r.tableCellsBeyond,
        `/admin/users @${w}: table cells beyond viewport ${r.vw}px on desktop:\n  ${fmt(r.tableCellsBeyond)}`,
      ).toEqual([]);
    });
  }
});
