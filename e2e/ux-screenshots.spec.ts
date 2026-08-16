/**
 * Temporary BEFORE/AFTER screenshot capture for /dispatch and /behavior.
 * Not part of the committed test suite — used by the UX redesign slices 5-6
 * task to produce visual evidence. Creates a disposable SUPERVISOR user
 * (with transport company) exactly like shell-geometry.spec.ts, then
 * screenshots both pages at 1440x900 and 390x844.
 */
import { test, type Browser } from "playwright/test";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const AUTH_SECRET = process.env.AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

const UID = "e2e-ux-shot-temp";
const TCID = "e2e-ux-shot-tc";
const WEEKID = "e2e-ux-shot-week";
const EMAIL = "e2e-ux-shot@instalog.com.br";
const COOKIE = "authjs.session-token";
const TAG = process.env.SHOT_TAG ?? "before";

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

async function shot(
  browser: Browser,
  path: string,
  width: number,
  height: number,
  token: string,
  file: string,
) {
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
    // Hide the Next.js dev overlay (dev-only console-error badge) so the
    // screenshots show the actual UI, not the tooling chrome.
    await page.addStyleTag({
      content: `nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay] { display: none !important; }`,
    });
    await page.screenshot({ path: file, fullPage: true });
    console.log(`saved ${file}`);
  } finally {
    await context.close();
  }
}

test.describe("ux screenshots", () => {
  let client: pg.Client;
  let token: string;

  test.beforeAll(async () => {
    if (!AUTH_SECRET || !DATABASE_URL) {
      throw new Error("requires AUTH_SECRET and DATABASE_URL");
    }
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [EMAIL]);
    await client.query(`DELETE FROM "users" WHERE id = $1`, [UID]);
    await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);
    await client.query(
      `INSERT INTO "transport_companies" ("id", "name", "createdAt", "updatedAt")
       VALUES ($1, 'E2E UX Shot Transport', now(), now())`,
      [TCID],
    );
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E UX Shot', 'SUPERVISOR', true, $3, now(), now())`,
      [UID, EMAIL, TCID],
    );
    await client.query(
      `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'SUPERVISOR', 'ACTIVE', now(), now())`,
      [EMAIL],
    );
    // A week + one vacancy so /dispatch shows the operational table, not just
    // the empty state.
    await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
    await client.query(
      `INSERT INTO "dispatch_weeks"
         ("id", "transportCompanyId", "weekKey", "year", "weekNumber", "startDate", "endDate", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'WK-33', 2026, 33, '2026-08-16', '2026-08-22', 'PLANNING', now(), now())`,
      [WEEKID, TCID],
    );
    await client.query(
      `INSERT INTO "vacancies"
         ("id", "dispatchWeekId", "date", "vehicleType", "shiftBlock", "quantity", "createdAt", "updatedAt")
       VALUES
         (gen_random_uuid(), $1, '2026-08-17', 'CARGO_VAN', 'Ciclo 1 - Manhã', 18, now(), now()),
         (gen_random_uuid(), $1, '2026-08-18', 'LARGE_VAN', 'Ciclo 2 - Tarde', 9, now(), now())`,
      [WEEKID],
    );
    token = await forgeJWT({
      id: UID,
      email: EMAIL,
      name: "E2E UX Shot",
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

  test("capture dispatch + behavior, desktop and mobile", async ({ browser }) => {
    test.setTimeout(120_000);
    for (const path of ["/dispatch", "/behavior"]) {
      const name = path.slice(1);
      await shot(browser, path, 1440, 900, token, `e2e/screenshots/${TAG}-${name}-desktop.png`);
      await shot(browser, path, 390, 844, token, `e2e/screenshots/${TAG}-${name}-mobile.png`);
    }
  });
});
