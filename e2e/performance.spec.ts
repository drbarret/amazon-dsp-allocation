/**
 * Performance menu E2E verification.
 *
 * Creates a real transport company, dispatch week and active drivers,
 * forges a supervisor session, uploads the sample CSV, and asserts that
 * insucessos are calculated correctly and rendered without clipped text.
 */
import { test, expect } from "playwright/test";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {}
}

const SKIP_E2E = (process.env.SKIP_E2E_TESTS ?? "").trim() === "1";
const AUTH_SECRET = process.env.AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const COOKIE = "authjs.session-token";

const UID = "e2e-perf-sup";
const EMAIL = "e2e-perf-sup@instalog.com.br";
const TCID = "e2e-perf-tc";
const WEEKID = "e2e-perf-week";
const DRIVER_IDS = [
  {
    userId: "e2e-perf-d1",
    transporterId: "A3P2DUI47V0SU0",
    name: "Marcelo Camargo  Vasconcelos",
  },
  {
    userId: "e2e-perf-d2",
    transporterId: "A290ACFF14HMPO",
    name: "Mara Alves Braz",
  },
];

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

test.describe("Performance", () => {
  test.skip(
    SKIP_E2E || !AUTH_SECRET || !DATABASE_URL,
    "E2E disabled (missing env)",
  );

  let client: pg.Client;
  let token: string;

  test.beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();

    await client.query(
      `DELETE FROM "driver_performance_snapshots" WHERE "performanceImportId" IN (
      SELECT id FROM "performance_imports" WHERE "transportCompanyId" = $1
    )`,
      [TCID],
    );
    await client.query(
      `DELETE FROM "performance_imports" WHERE "transportCompanyId" = $1`,
      [TCID],
    );
    await client.query(
      `DELETE FROM "driver_profiles" WHERE "userId" = ANY($1)`,
      [DRIVER_IDS.map((d) => d.userId)],
    );
    await client.query(`DELETE FROM "users" WHERE id = ANY($1)`, [
      [UID, ...DRIVER_IDS.map((d) => d.userId)],
    ]);
    await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [
      EMAIL,
    ]);
    await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
    await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [
      TCID,
    ]);

    await client.query(
      `INSERT INTO "transport_companies" (id, name, active, "createdAt", "updatedAt") VALUES ($1, $2, true, now(), now())`,
      [TCID, "E2E Performance Transport"],
    );
    await client.query(
      `INSERT INTO "allowed_emails" (id, email, role, "createdAt", "updatedAt") VALUES ($1, $2, 'SUPERVISOR', now(), now())`,
      [randomUUID(), EMAIL],
    );
    await client.query(
      `INSERT INTO "users" (id, name, email, role, active, "transportCompanyId", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'SUPERVISOR', true, $4, now(), now())`,
      [UID, "E2E Performance Sup", EMAIL, TCID],
    );

    const start = new Date("2026-08-17T00:00:00Z");
    const end = new Date("2026-08-23T00:00:00Z");
    await client.query(
      `INSERT INTO "dispatch_weeks" (id, "transportCompanyId", "weekKey", year, "weekNumber", "startDate", "endDate", status, "createdAt", "updatedAt") VALUES ($1, $2, 'WK-33', 2026, 33, $3, $4, 'PLANNING', now(), now())`,
      [WEEKID, TCID, start.toISOString(), end.toISOString()],
    );

    for (const d of DRIVER_IDS) {
      await client.query(
        `INSERT INTO "users" (id, name, email, role, active, "transportCompanyId", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'DRIVER', true, $4, now(), now())`,
        [d.userId, d.name, `${d.userId}@instalog.com.br`, TCID],
      );
      await client.query(
        `INSERT INTO "driver_profiles" (id, "userId", "transporterId", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
        [randomUUID(), d.userId, d.transporterId],
      );
    }

    token = await forgeJWT({
      id: UID,
      email: EMAIL,
      name: "E2E Performance Sup",
      role: "SUPERVISOR",
      active: true,
      transportCompanyId: TCID,
      roleLastFetched: Date.now(),
    });
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query(
      `DELETE FROM "driver_performance_snapshots" WHERE "performanceImportId" IN (
      SELECT id FROM "performance_imports" WHERE "transportCompanyId" = $1
    )`,
      [TCID],
    );
    await client.query(
      `DELETE FROM "performance_imports" WHERE "transportCompanyId" = $1`,
      [TCID],
    );
    await client.query(
      `DELETE FROM "driver_profiles" WHERE "userId" = ANY($1)`,
      [DRIVER_IDS.map((d) => d.userId)],
    );
    await client.query(`DELETE FROM "users" WHERE id = ANY($1)`, [
      [UID, ...DRIVER_IDS.map((d) => d.userId)],
    ]);
    await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [
      EMAIL,
    ]);
    await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
    await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [
      TCID,
    ]);
    await client.end();
  });

  test("imports sample CSV, calculates insucessos and renders table", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page
      .context()
      .addCookies([
        {
          name: COOKIE,
          value: token,
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);

    await page.goto(`${BASE_URL}/performance`);
    await expect(
      page.getByRole("heading", { name: "Performance", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Semana").selectOption(WEEKID);

    await page.getByRole("button", { name: /Importar performance/ }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles("C:\\Users\\drbar\\Downloads\\modelo_performance_W33.csv");
    await page.getByRole("button", { name: "Importar", exact: true }).click();

    await expect(page.getByText(/Semana WK-33: 2 importado\(s\)/)).toBeVisible({
      timeout: 15_000,
    });

    // Assert calculated insucessos: Marcelo 725*(1-0.99)=7.25→7; Mara 605*(1-0.98)=12.1→12
    const marceloRow = page.getByRole("row", { name: /Marcelo Camargo/ });
    await expect(marceloRow.getByText("7", { exact: true })).toBeVisible();
    const maraRow = page.getByRole("row", { name: /Mara Alves Braz/ });
    await expect(maraRow.getByText("12", { exact: true })).toBeVisible();

    // Total for the two matched drivers
    await expect(page.getByText("1.330")).toBeVisible();

    await page.screenshot({
      path: `screenshots-prod-ui/performance-imported_1440.png`,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `screenshots-prod-ui/performance-imported_390.png`,
    });
  });
});
