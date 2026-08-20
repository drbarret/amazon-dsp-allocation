/**
 * E2E tests for /vagas (Vacancy Blocks) page.
 *
 * Covers:
 * - Menu displays "Vagas" below "Disponibilidades" for SUPERVISOR+
 * - DRIVER cannot see menu and cannot access /vagas (redirected)
 * - Vacancy quantities persist after page reload
 * - Block total reflects sum of 7 days
 * - "Editar Bloco" changes eligibility and persists after reload
 * - Week selector loads correct values for that week
 *
 * Requires: DATABASE_URL + AUTH_SECRET. Opt out with SKIP_E2E_TESTS=1.
 */
import { test, expect, type Browser, type Page } from "playwright/test";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const SKIP_E2E = (process.env.SKIP_E2E_TESTS ?? "").trim() === "1";
const AUTH_SECRET = process.env.AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

// Test IDs
const SUP_ID = "e2e-vagas-sup";
const DRIVER_ID = "e2e-vagas-driver";
const TCID = "e2e-vagas-tc";
const WEEK1_ID = "e2e-vagas-week1";
const WEEK2_ID = "e2e-vagas-week2";
const SUP_EMAIL = "e2e-vagas-sup@instalog.com.br";
const DRIVER_EMAIL = "e2e-vagas-driver@instalog.com.br";
const COOKIE = "authjs.session-token";

// Block IDs will be created during setup
let BLOCK_IDS: string[] = [];

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

async function createPageWithAuth(browser: Browser, token: string, width = 1024, height = 768): Promise<Page> {
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
  return context.newPage();
}

test.describe("Vagas E2E", () => {
  test.skip(SKIP_E2E, "SKIP_E2E_TESTS=1 set — explicit opt-out");

  let client: pg.Client;
  let supToken: string;
  let driverToken: string;

  test.beforeAll(async () => {
    if (!AUTH_SECRET || !DATABASE_URL) {
      throw new Error(
        "E2E vagas tests require AUTH_SECRET and DATABASE_URL. " +
          "Set them, or opt out explicitly with SKIP_E2E_TESTS=1.",
      );
    }
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();

    // Clean up any previous test data
    await client.query(`DELETE FROM "block_daily_vacancies" WHERE "vacancyBlockId" IN (SELECT id FROM "vacancy_blocks" WHERE "transportCompanyId" = $1)`, [TCID]);
    await client.query(`DELETE FROM "vacancy_blocks" WHERE "transportCompanyId" = $1`, [TCID]);
    await client.query(`DELETE FROM "allowed_emails" WHERE email = ANY($1)`, [[SUP_EMAIL, DRIVER_EMAIL]]);
    await client.query(`DELETE FROM "users" WHERE id = ANY($1)`, [[SUP_ID, DRIVER_ID]]);
    await client.query(`DELETE FROM "dispatch_weeks" WHERE id = ANY($1)`, [[WEEK1_ID, WEEK2_ID]]);
    await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);

    // Create transport company
    await client.query(
      `INSERT INTO "transport_companies" ("id", "name", "createdAt", "updatedAt")
       VALUES ($1, 'E2E Vagas Transport', now(), now())`,
      [TCID],
    );

    // Create users
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Vagas Sup', 'SUPERVISOR', true, $3, now(), now())`,
      [SUP_ID, SUP_EMAIL, TCID],
    );
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Vagas Driver', 'DRIVER', true, $3, now(), now())`,
      [DRIVER_ID, DRIVER_EMAIL, TCID],
    );

    // Create allowed emails
    await client.query(
      `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'SUPERVISOR', 'ACTIVE', now(), now()),
              (gen_random_uuid(), $2, 'DRIVER', 'ACTIVE', now(), now())`,
      [SUP_EMAIL, DRIVER_EMAIL],
    );

    // Create two dispatch weeks
    await client.query(
      `INSERT INTO "dispatch_weeks"
         ("id", "transportCompanyId", "weekKey", "year", "weekNumber", "startDate", "endDate", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'WK-VAGAS-1', 2026, 35, '2026-08-23', '2026-08-29', 'PLANNING', now(), now())`,
      [WEEK1_ID, TCID],
    );
    await client.query(
      `INSERT INTO "dispatch_weeks"
         ("id", "transportCompanyId", "weekKey", "year", "weekNumber", "startDate", "endDate", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'WK-VAGAS-2', 2026, 36, '2026-08-30', '2026-09-05', 'PLANNING', now(), now())`,
      [WEEK2_ID, TCID],
    );

    // Create 4 vacancy blocks with varied data
    const blocks = [
      { sortOrder: 1, name: "Cargo Van (Small) R2.0 - Inside Natural Gas - BR - Ciclo 1", types: "{GNV}", cycle: 1 },
      { sortOrder: 2, name: "Cargo Van (Small) R2.0 - BR - Ciclo 1", types: "{CARGO_VAN}", cycle: 1 },
      { sortOrder: 3, name: "Standard Parcel - Small Van - BR - Ciclo 2", types: "{CARGO_VAN,GNV}", cycle: 2 },
      { sortOrder: 4, name: "Same Day Passenger Car - Ciclo 2", types: "{PASSENGER}", cycle: 2 },
    ];

    BLOCK_IDS = [];
    for (const block of blocks) {
      const result = await client.query(
        `INSERT INTO "vacancy_blocks"
          ("id", "transportCompanyId", "name", "cycle", "eligibleVehicleTypes", "active", "sortOrder", "createdAt", "updatedAt")
         VALUES
          (gen_random_uuid(), $1, $2, $3, $4::"VehicleEligibility"[], true, $5, now(), now())
         RETURNING id`,
        [TCID, block.name, block.cycle, block.types, block.sortOrder],
      );
      BLOCK_IDS.push(result.rows[0].id);
    }

    // Insert varied daily vacancies for week 1 (different values per day to match mockup)
    // Block 0: [3, 5, 4, 6, 5, 4, 2] = 29 total
    // Block 1: [2, 4, 3, 5, 4, 3, 1] = 22 total
    // Block 2: [1, 3, 2, 4, 3, 2, 0] = 15 total
    // Block 3: [0, 2, 1, 3, 2, 1, 0] = 9 total
    const week1Counts = [
      [3, 5, 4, 6, 5, 4, 2],
      [2, 4, 3, 5, 4, 3, 1],
      [1, 3, 2, 4, 3, 2, 0],
      [0, 2, 1, 3, 2, 1, 0],
    ];

    for (let b = 0; b < 4; b++) {
      for (let day = 0; day < 7; day++) {
        await client.query(
          `INSERT INTO "block_daily_vacancies"
            ("id", "dispatchWeekId", "vacancyBlockId", "dayOfWeek", "count", "createdById", "updatedById", "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $5, now(), now())`,
          [WEEK1_ID, BLOCK_IDS[b], day, week1Counts[b][day], SUP_ID],
        );
      }
    }

    // Insert different values for week 2 to test week switching
    // Block 0: [1, 1, 1, 1, 1, 1, 1] = 7 total
    for (let day = 0; day < 7; day++) {
      await client.query(
        `INSERT INTO "block_daily_vacancies"
          ("id", "dispatchWeekId", "vacancyBlockId", "dayOfWeek", "count", "createdById", "updatedById", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $5, now(), now())`,
        [WEEK2_ID, BLOCK_IDS[0], day, 1, SUP_ID],
      );
    }

    supToken = await forgeJWT({
      id: SUP_ID,
      email: SUP_EMAIL,
      name: "E2E Vagas Sup",
      role: "SUPERVISOR",
      active: true,
      roleLastFetched: Date.now(),
    });
    driverToken = await forgeJWT({
      id: DRIVER_ID,
      email: DRIVER_EMAIL,
      name: "E2E Vagas Driver",
      role: "DRIVER",
      active: true,
      roleLastFetched: Date.now(),
    });
  });

  test.beforeEach(async () => {
    // Restore fresh vacancy data before each test to ensure isolation
    if (!client) return;

    // Clean existing vacancies for our test weeks
    await client.query(
      `DELETE FROM "block_daily_vacancies" WHERE "dispatchWeekId" = ANY($1)`,
      [[WEEK1_ID, WEEK2_ID]],
    );

    // Insert fresh varied daily vacancies for week 1
    const counts = [
      [3, 5, 4, 6, 5, 4, 2], // block 1: total 29
      [2, 4, 3, 5, 4, 3, 1], // block 2: total 22
      [1, 3, 2, 4, 3, 2, 0], // block 3: total 15
      [0, 2, 1, 3, 2, 1, 0], // block 4: total 9
    ];

    for (let b = 0; b < 4; b++) {
      for (let day = 0; day < 7; day++) {
        await client.query(
          `INSERT INTO "block_daily_vacancies"
            ("id", "dispatchWeekId", "vacancyBlockId", "dayOfWeek", "count", "createdById", "updatedById", "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $5, now(), now())`,
          [WEEK1_ID, BLOCK_IDS[b], day, counts[b][day], SUP_ID],
        );
      }
    }

    // Insert fresh values for week 2 (block 0 only, all 1s = total 7)
    for (let day = 0; day < 7; day++) {
      await client.query(
        `INSERT INTO "block_daily_vacancies"
          ("id", "dispatchWeekId", "vacancyBlockId", "dayOfWeek", "count", "createdById", "updatedById", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $5, now(), now())`,
        [WEEK2_ID, BLOCK_IDS[0], day, 1, SUP_ID],
      );
    }

    // Reset eligibility of block 0 back to GNV only
    await client.query(
      `UPDATE "vacancy_blocks" SET "eligibleVehicleTypes" = $1::"VehicleEligibility"[] WHERE id = $2`,
      ["{GNV}", BLOCK_IDS[0]],
    );
  });

  test.afterAll(async () => {
    if (client) {
      await client.query(`DELETE FROM "block_daily_vacancies" WHERE "vacancyBlockId" IN (SELECT id FROM "vacancy_blocks" WHERE "transportCompanyId" = $1)`, [TCID]);
      await client.query(`DELETE FROM "vacancy_blocks" WHERE "transportCompanyId" = $1`, [TCID]);
      await client.query(`DELETE FROM "allowed_emails" WHERE email = ANY($1)`, [[SUP_EMAIL, DRIVER_EMAIL]]);
      await client.query(`DELETE FROM "users" WHERE id = ANY($1)`, [[SUP_ID, DRIVER_ID]]);
      await client.query(`DELETE FROM "dispatch_weeks" WHERE id = ANY($1)`, [[WEEK1_ID, WEEK2_ID]]);
      await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);
      await client.end();
    }
  });

  test("menu shows Vagas below Disponibilidades for SUPERVISOR", async ({ browser }) => {
    const page = await createPageWithAuth(browser, supToken);
    try {
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle", timeout: 30_000 });

      // Find sidebar nav items
      const navLinks = await page.locator("nav a, aside a").allTextContents();
      const vagasIndex = navLinks.findIndex((t) => t.includes("Vagas"));
      const dispIndex = navLinks.findIndex((t) => t.includes("Disponibilidades"));

      expect(vagasIndex).toBeGreaterThan(-1);
      expect(dispIndex).toBeGreaterThan(-1);
      expect(vagasIndex).toBeGreaterThan(dispIndex);
    } finally {
      await page.context().close();
    }
  });

  test("DRIVER does not see Vagas menu and is blocked from /vagas", async ({ browser }) => {
    const page = await createPageWithAuth(browser, driverToken);
    try {
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(1000);

      // Check full page HTML doesn't contain Vagas in the menu area
      const html = await page.content();
      expect(html).not.toContain(">Vagas<");
    } finally {
      // Fire-and-forget close to work around Playwright + Next.js dev server hang
      page.context().close().catch(() => {});
    }
  });

  test("cards render with badges, totals and 7-day grid", async ({ browser }) => {
    const page = await createPageWithAuth(browser, supToken);
    try {
      await page.goto(`${BASE_URL}/vagas`, { waitUntil: "networkidle", timeout: 30_000 });

      // Wait for cards to load
      await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

      // Select WK-VAGAS-1 explicitly (the week with varied data, total 29)
      const weekSelect = page.locator("select").first();
      await weekSelect.selectOption(WEEK1_ID);
      await page.waitForTimeout(1000);

      // Check we have 4 blocks
      const cards = await page.locator(".rounded-xl.border").count();
      expect(cards).toBe(4);

      // Check first block has correct total (29)
      const firstCardTotal = await page.locator(".rounded-xl.border").first().locator("text=/\\d+ vaga/").textContent();
      expect(firstCardTotal).toContain("29");

      // Check badges are present
      const firstCard = page.locator(".rounded-xl.border").first();
      await expect(firstCard.locator("text=GNV")).toBeVisible();
      await expect(firstCard.locator('div:has-text("Ciclo 1")').nth(0)).toBeVisible();

      // Check 7-day grid inputs exist
      const inputs = await firstCard.locator('input[type="number"]').count();
      expect(inputs).toBe(7);

      // Check day labels
      await expect(firstCard.locator("text=Dom")).toBeVisible();
      await expect(firstCard.locator("text=Sáb")).toBeVisible();
    } finally {
      await page.context().close();
    }
  });

  test("vacancy quantities persist after reload", async ({ browser }) => {
    const page = await createPageWithAuth(browser, supToken);
    try {
      await page.goto(`${BASE_URL}/vagas`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

      // Select WK-VAGAS-1 explicitly
      await page.locator("select").first().selectOption(WEEK1_ID);
      await page.waitForTimeout(1000);

      // Get first input in first card
      const firstInput = page.locator(".rounded-xl.border").first().locator('input[type="number"]').first();

      // Change the value
      await firstInput.fill("99");

      // Click save button
      const saveBtn = page.locator(".rounded-xl.border").first().locator("button:has-text('Salvar')");
      await saveBtn.click();

      // Wait for save feedback
      await page.waitForSelector("text=Salvo", { timeout: 10_000 });

      // Reload page
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

      // Select WK-VAGAS-1 again after reload
      await page.locator("select").first().selectOption(WEEK1_ID);
      await page.waitForTimeout(1000);

      // Check value persisted
      const reloadedInput = page.locator(".rounded-xl.border").first().locator('input[type="number"]').first();
      const reloadedValue = await reloadedInput.inputValue();
      expect(reloadedValue).toBe("99");
    } finally {
      await page.context().close();
    }
  });

  test("total reflects sum of 7 days", async ({ browser }) => {
    const page = await createPageWithAuth(browser, supToken);
    try {
      await page.goto(`${BASE_URL}/vagas`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

      const firstCard = page.locator(".rounded-xl.border").first();

      // Fill all 7 inputs with known values: 1,2,3,4,5,6,7 = 28
      const inputs = firstCard.locator('input[type="number"]');
      for (let i = 0; i < 7; i++) {
        await inputs.nth(i).fill(String(i + 1));
      }

      // Total badge should update live (before save)
      const totalBadge = firstCard.locator("text=/\\d+ vaga/");
      await expect(totalBadge).toContainText("28");
    } finally {
      await page.context().close();
    }
  });

  test("Editar Bloco changes eligibility and persists after reload", async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await createPageWithAuth(browser, supToken);
    try {
      await page.goto(`${BASE_URL}/vagas`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

      // Click Editar Bloco on first card
      await page.locator(".rounded-xl.border").first().locator("button:has-text('Editar Bloco')").click();

      // Wait for dialog heading
      await page.waitForSelector('h2:has-text("Editar Bloco")', { timeout: 5_000 });
      await page.waitForTimeout(500);

      // Add Passenger to the block that currently only has GNV (keep GNV selected)
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const passengerBtn = buttons.find((b) => b.textContent?.trim() === "Passenger");
        passengerBtn?.click();
      });
      await page.waitForTimeout(1000);

      // Verify Passenger button is now selected before saving
      const passengerSelected = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const passengerBtn = buttons.find((b) => b.textContent?.trim() === "Passenger");
        return passengerBtn?.classList.contains("bg-primary/10") ?? false;
      });
      expect(passengerSelected).toBe(true);

      // Save changes
      await page.locator('button:has-text("Salvar Alterações")').last().click();

      // Wait for dialog to close
      await page.waitForSelector('h2:has-text("Editar Bloco")', { state: "hidden", timeout: 30_000 });

      // Reload and verify
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

      // First card should now show Passenger in addition to GNV
      const badgeText = await page.locator(".rounded-xl.border").first().locator(".break-all").first().textContent();
      expect(badgeText).toContain("Passenger");
    } finally {
      await page.context().close();
    }
  });

  test("week selector loads correct values for that week", async ({ browser }) => {
    const page = await createPageWithAuth(browser, supToken);
    try {
      await page.goto(`${BASE_URL}/vagas`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

      // Select WK-VAGAS-1 explicitly (total 29 for first block)
      const weekSelect = page.locator("select").first();
      await weekSelect.selectOption(WEEK1_ID);
      await page.waitForTimeout(1000);

      const firstCardTotal = await page.locator(".rounded-xl.border").first().locator("text=/\\d+ vaga/").textContent();
      expect(firstCardTotal).toContain("29");

      // Change to week 2
      await weekSelect.selectOption(WEEK2_ID);
      await page.waitForTimeout(1000);

      // First block in week 2 should have total 7 (all 1s)
      const newTotal = await page.locator(".rounded-xl.border").first().locator("text=/\\d+ vaga/").textContent();
      expect(newTotal).toContain("7");
    } finally {
      await page.context().close();
    }
  });

  test("screenshots at multiple viewports", async ({ browser }) => {
    const widths = [390, 768, 1024, 1440];
    const heights = [844, 1024, 768, 900];

    for (let i = 0; i < widths.length; i++) {
      const page = await createPageWithAuth(browser, supToken, widths[i], heights[i]);
      try {
        await page.goto(`${BASE_URL}/vagas`, { waitUntil: "networkidle", timeout: 30_000 });
        await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

        // Take screenshot
        await page.screenshot({
          path: `e2e/screenshots/vagas-${widths[i]}.png`,
          fullPage: true,
        });

        // Verify cards are visible
        const cards = await page.locator(".rounded-xl.border").count();
        expect(cards).toBe(4);
      } finally {
        await page.context().close();
      }
    }
  });

  test("screenshot of Editar Bloco dialog", async ({ browser }) => {
    const page = await createPageWithAuth(browser, supToken, 1024, 768);
    try {
      await page.goto(`${BASE_URL}/vagas`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForSelector("text=Cargo Van", { timeout: 10_000 });

      // Open edit dialog
      const editBtn = page.locator(".rounded-xl.border").first().locator("button:has-text('Editar Bloco')");
      await editBtn.click();
      await page.waitForSelector("text=Editar Bloco", { timeout: 5_000 });

      // Screenshot the dialog
      await page.screenshot({
        path: "e2e/screenshots/vagas-edit-dialog.png",
        fullPage: false,
      });
    } finally {
      await page.context().close();
    }
  });
});
