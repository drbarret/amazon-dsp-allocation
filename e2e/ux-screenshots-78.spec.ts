/**
 * Screenshot capture for /drivers, /cnh, /admin/users (UX redesign slices 7-8).
 * Creates a disposable SUPERVISOR user (with transport company), then
 * screenshots the three pages at 1440x900 and 390x844.
 *
 * Run: npx playwright test e2e/ux-screenshots-78.spec.ts
 * Requires: dev server on :3100, DATABASE_URL + AUTH_SECRET in .env.local
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

const UID = "e2e-ux78-temp";
const TCID = "e2e-ux78-tc";
const EMAIL = "e2e-ux78@instalog.com.br";
const COOKIE = "authjs.session-token";
const TAG = process.env.SHOT_TAG ?? "after";

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
    await page.addStyleTag({
      content: `nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay] { display: none !important; }`,
    });
    await page.screenshot({ path: file, fullPage: false });
    console.log(`saved ${file}`);
  } finally {
    await context.close();
  }
}

test.describe("ux screenshots slices 7-8", () => {
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
       VALUES ($1, 'E2E UX78 Transport', now(), now())`,
      [TCID],
    );
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E UX78', 'ACCOUNT_MANAGER', true, $3, now(), now())`,
      [UID, EMAIL, TCID],
    );
    await client.query(
      `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'ACCOUNT_MANAGER', 'ACTIVE', now(), now())`,
      [EMAIL],
    );
    token = await forgeJWT({
      id: UID,
      email: EMAIL,
      name: "E2E UX78",
      role: "ACCOUNT_MANAGER",
      active: true,
      roleLastFetched: Date.now(),
    });
  });

  test.afterAll(async () => {
    if (client) {
      await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [EMAIL]);
      await client.query(`DELETE FROM "users" WHERE id = $1`, [UID]);
      await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);
      await client.end();
    }
  });

  test("capture drivers + cnh + admin/users, desktop and mobile", async ({ browser }) => {
    test.setTimeout(120_000);
    for (const path of ["/drivers", "/cnh", "/admin/users"]) {
      const name = path.replace(/\//g, "-").replace(/^-/, "");
      await shot(browser, path, 1440, 900, token, `e2e/screenshots/${TAG}-${name}-desktop.png`);
      await shot(browser, path, 390, 844, token, `e2e/screenshots/${TAG}-${name}-mobile.png`);
    }
  });
});
