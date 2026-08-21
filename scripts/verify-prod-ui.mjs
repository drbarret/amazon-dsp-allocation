#!/usr/bin/env node
// ============================================================
// Verificação em Produção — Motoristas (UI REAL via Playwright)
//
// Todas as ações são executadas PELA INTERFACE usando Playwright headless.
// SQL é usado APENAS para:
//   (a) Criar e limpar fixtures
//   (b) Ler estado final como conferência extra
//
// NUNCA executa a ação sendo testada via SQL.
// ============================================================

import { chromium } from "playwright";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const PROD_URL = "https://amazon-dsp-allocation.vercel.app";
const AUTH_SECRET = process.env.AUTH_SECRET;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) { console.error("DATABASE_URL not set"); process.exit(1); }
if (!AUTH_SECRET) { console.error("AUTH_SECRET not set"); process.exit(1); }

const COOKIE_NAME = "__Secure-authjs.session-token";
const SCREENSHOT_DIR = "C:\\Users\\drbar\\Projects\\amazon-dsp-allocation\\screenshots-prod-ui";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function forgeJWT(payload) {
  const enc = "A256CBC-HS512";
  const key = await hkdf(
    "sha256",
    AUTH_SECRET,
    new TextEncoder().encode(COOKIE_NAME),
    `Auth.js Generated Encryption Key (${COOKIE_NAME})`,
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

const TIMESTAMP = Date.now();
const PREFIX = `__verify_prod_${TIMESTAMP}`;

const FIXTURES = {
  supervisorEmail: `${PREFIX}_sup@test.local`,
  amEmail: `${PREFIX}_am@test.local`,
  driverEmail: `${PREFIX}_drv@test.local`,
  otherSupEmail: `${PREFIX}_other_sup@test.local`,
};

const { Client } = pg;
const db = new Client({ connectionString: databaseUrl });

let results = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function record(testName, status, detail = "") {
  log(`${status}: ${testName}${detail ? ` — ${detail}` : ""}`);
  results.push({ test: testName, status, detail });
  if (status === "PASS") passed++;
  else if (status === "FAIL") failed++;
  else skipped++;
}

async function countTable(table) {
  const r = await db.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
  return r.rows[0].c;
}

async function countVerifyProd() {
  const r = await db.query(
    `SELECT COUNT(*)::int AS c FROM users WHERE email LIKE $1`,
    [`${PREFIX}%`]
  );
  return r.rows[0].c;
}

async function snapshot() {
  return {
    users: await countTable("users"),
    driver_profiles: await countTable("driver_profiles"),
    transport_companies: await countTable("transport_companies"),
    deactivation_requests: await countTable("deactivation_requests"),
    region_city_preferences: await countTable("region_city_preferences"),
    verifyProd: await countVerifyProd(),
  };
}

// ============================================================
// SETUP: Create fixtures via SQL (allowed)
// ============================================================

async function setupFixtures() {
  log("Creating fixtures...");

  const tcResult = await db.query(
    `SELECT id FROM transport_companies WHERE active = true LIMIT 1`
  );
  if (tcResult.rows.length === 0) throw new Error("No active transport company found");
  const transportCompanyId = tcResult.rows[0].id;

  // Second transport company for scenario 6
  const otherTcResult = await db.query(
    `SELECT id FROM transport_companies WHERE active = true AND id != $1 LIMIT 1`,
    [transportCompanyId]
  );
  let otherTransportCompanyId = null;
  if (otherTcResult.rows.length > 0) {
    otherTransportCompanyId = otherTcResult.rows[0].id;
  } else {
    // Create a second transport company as fixture
    const newTc = await db.query(
      `INSERT INTO transport_companies (id, name, active, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), 'Verify Other TC', true, now(), now()) RETURNING id`,
    );
    otherTransportCompanyId = newTc.rows[0].id;
    log(`Created second transport company: ${otherTransportCompanyId}`);
  }

  // Supervisor
  const supResult = await db.query(
    `INSERT INTO users (id, email, name, role, "transportCompanyId", active, "emailVerified", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Verify Supervisor', 'SUPERVISOR', $2, true, now(), now(), now())
     RETURNING id`,
    [FIXTURES.supervisorEmail, transportCompanyId]
  );
  const supervisorId = supResult.rows[0].id;

  // Account Manager
  const amResult = await db.query(
    `INSERT INTO users (id, email, name, role, "transportCompanyId", active, "emailVerified", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Verify AM', 'ACCOUNT_MANAGER', $2, true, now(), now(), now())
     RETURNING id`,
    [FIXTURES.amEmail, transportCompanyId]
  );
  const amId = amResult.rows[0].id;

  // Driver with profile
  const drvResult = await db.query(
    `INSERT INTO users (id, email, name, role, "transportCompanyId", active, "emailVerified", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Verify Driver', 'DRIVER', $2, true, now(), now(), now())
     RETURNING id`,
    [FIXTURES.driverEmail, transportCompanyId]
  );
  const driverUserId = drvResult.rows[0].id;

  await db.query(
    `INSERT INTO driver_profiles (id, "userId", "vehicleType", "transporterId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'CARGO_VAN', 'T-VERIFY', now(), now())`,
    [driverUserId]
  );

  // Other-company supervisor
  const otherSupResult = await db.query(
    `INSERT INTO users (id, email, name, role, "transportCompanyId", active, "emailVerified", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Verify Other Sup', 'SUPERVISOR', $2, true, now(), now(), now())
     RETURNING id`,
    [FIXTURES.otherSupEmail, otherTransportCompanyId]
  );
  const otherSupervisorId = otherSupResult.rows[0].id;

  // Forge JWTs
  const supToken = await forgeJWT({
    id: supervisorId, email: FIXTURES.supervisorEmail, name: "Verify Supervisor",
    role: "SUPERVISOR", active: true, transportCompanyId, roleLastFetched: Date.now(),
  });

  const amToken = await forgeJWT({
    id: amId, email: FIXTURES.amEmail, name: "Verify AM",
    role: "ACCOUNT_MANAGER", active: true, transportCompanyId, roleLastFetched: Date.now(),
  });

  const otherSupToken = await forgeJWT({
    id: otherSupervisorId, email: FIXTURES.otherSupEmail, name: "Verify Other Sup",
    role: "SUPERVISOR", active: true, transportCompanyId: otherTransportCompanyId, roleLastFetched: Date.now(),
  });

  log(`Fixtures created. Driver: ${driverUserId}, Sup: ${supervisorId}, AM: ${amId}, OtherSup: ${otherSupervisorId}`);
  return {
    driverUserId, supervisorId, amId, otherSupervisorId,
    transportCompanyId, otherTransportCompanyId,
    supToken, amToken, otherSupToken,
  };
}

// ============================================================
// CLEANUP
// ============================================================

async function cleanupFixtures() {
  log("Cleaning up fixtures...");
  await db.query(
    `DELETE FROM deactivation_requests
     WHERE "driverUserId" IN (SELECT id FROM users WHERE email LIKE $1)
        OR "requestedById" IN (SELECT id FROM users WHERE email LIKE $1)
        OR "reviewerId" IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${PREFIX}%`]
  );
  await db.query(
    `DELETE FROM region_city_preferences
     WHERE "driverProfileId" IN (
       SELECT dp.id FROM driver_profiles dp JOIN users u ON dp."userId" = u.id WHERE u.email LIKE $1
     )`,
    [`${PREFIX}%`]
  );
  await db.query(
    `DELETE FROM driver_profiles WHERE "userId" IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${PREFIX}%`]
  );
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`]);
  // Clean up the second transport company if we created it
  await db.query(`DELETE FROM transport_companies WHERE name = 'Verify Other TC'`);
  log("Cleanup complete.");
}

// ============================================================
// Helper: create browser context with cookie
// ============================================================

async function createContextWithToken(browser, token, viewportWidth = 1440) {
  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: 900 },
  });
  await context.addCookies([{
    name: COOKIE_NAME,
    value: token,
    domain: "amazon-dsp-allocation.vercel.app",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  return context;
}

async function takeScreenshot(page, name, width) {
  const path = `${SCREENSHOT_DIR}\\${name}_${width}.png`;
  await page.screenshot({ path, fullPage: true });
  log(`Screenshot saved: ${path}`);
  return path;
}

// ============================================================
// SCENARIOS
// ============================================================

async function runScenarios(data) {
  const {
    driverUserId, supervisorId, amId, otherSupervisorId,
    transportCompanyId, otherTransportCompanyId,
    supToken, amToken, otherSupToken,
  } = data;

  const browser = await chromium.launch({ headless: true });
  const screenshots = [];

  try {
    // ================================================================
    // SCENARIO 1: SUPERVISOR edits Name and WhatsApp Group via UI
    // ================================================================
    log("=== Scenario 1: Supervisor edits driver basic data via UI ===");
    {
      const ctx = await createContextWithToken(browser, supToken, 1440);
      const page = await ctx.newPage();
      await page.goto(`${PROD_URL}/drivers?status=all`, { waitUntil: "networkidle", timeout: 30000 });

      // Verify table loads
      const hasTable = await page.locator("table").count() > 0;
      if (!hasTable) {
        record("S1", "FAIL", "Table not found on /drivers page");
        await ctx.close();
      } else {
        // Find the test driver row by searching for the email
        const searchInput = page.locator('input[aria-label="Buscar motorista"]');
        await searchInput.fill(FIXTURES.driverEmail);
        await page.waitForTimeout(500);

        // Click the edit (pencil) button for our driver
        const editBtn = page.locator('button[aria-label^="Editar "]').first();
        const editBtnCount = await editBtn.count();
        if (editBtnCount === 0) {
          record("S1", "FAIL", "Edit button not found for test driver");
          await ctx.close();
        } else {
          await editBtn.click();
          await page.waitForTimeout(500);

          // Verify modal opened
          const modalTitle = page.locator("h2:text('Editar Motorista')");
          const modalOpen = await modalTitle.count() > 0;
          if (!modalOpen) {
            record("S1", "FAIL", "Edit modal did not open");
            await ctx.close();
          } else {
            // Edit Name field
            const nameInput = page.locator('.fixed.inset-0 input').first();
            await nameInput.fill("");
            await nameInput.fill("Verify Edited Name UI");

            // Fill WhatsApp Group field - find by label text
            // Modal structure: label "Grupo WhatsApp" followed by input
            const modalContainer = page.locator('.fixed.inset-0.z-50');
            
            // Get all visible text inputs in the modal (not disabled, not hidden checkbox inputs)
            const textInputs = modalContainer.locator('input:not([disabled]):not([type="checkbox"]):not([aria-hidden="true"])');
            const tiCount = await textInputs.count();
            log(`  Found ${tiCount} text inputs in modal`);
            
            // Inputs order in JSX: Name, Email(disabled), Phone, TransporterID, WhatsAppGroup
            // After filtering disabled: Name(0), Phone(1), TransporterID(2), WhatsAppGroup(3)
            if (tiCount >= 4) {
              await textInputs.nth(3).fill("Grupo Verify UI");
              log("  Filled WhatsApp field");
            } else if (tiCount >= 3) {
              // Try filling last available input
              await textInputs.nth(tiCount - 1).fill("Grupo Verify UI");
              log(`  Filled last input (${tiCount - 1}) as WhatsApp`);
            }

            // Select at least one city (required validation)
            const cityButton = modalContainer.locator('button:has-text("Jundiaí")');
            if (await cityButton.count() > 0) {
              await cityButton.click();
              log("  Selected city: Jundiaí");
            }

            // Take screenshot of filled modal
            screenshots.push(await takeScreenshot(page, "modal-edit-filled", 1440));

            // Click Save
            const saveBtn = page.locator('.fixed.inset-0 button:has-text("Salvar")');
            const saveBtnCount = await saveBtn.count();
            log(`  Save button count: ${saveBtnCount}`);
            if (saveBtnCount > 0) {
              await saveBtn.click();
              log("  Clicked Save button");
            } else {
              log("  ERROR: Save button not found!");
            }

            // Wait for toast or navigation
            await page.waitForTimeout(3000);
            
            // Check for any toast
            const toasts = page.locator('[data-sonner-toast]');
            const toastCount = await toasts.count();
            log(`  Toast count after save: ${toastCount}`);
            if (toastCount > 0) {
              for (let i = 0; i < toastCount; i++) {
                const toastText = await toasts.nth(i).textContent();
                log(`  Toast ${i}: ${toastText}`);
              }
            }

            // Reload page to confirm persistence
            await page.reload({ waitUntil: "networkidle" });
            await searchInput.fill(FIXTURES.driverEmail);
            await page.waitForTimeout(500);

            // Check if new name appears in table
            const nameCell = page.locator(`text=Verify Edited Name UI`);
            const namePersisted = await nameCell.count() > 0;

            // Check WhatsApp in table
            const whatsappCell = page.locator(`text=Grupo Verify UI`);
            const whatsappPersisted = await whatsappCell.count() > 0;

            if (namePersisted && whatsappPersisted) {
              record("S1", "PASS", "Name and WhatsApp persisted after reload");
            } else {
              record("S1", "FAIL", `Name=${namePersisted}, WhatsApp=${whatsappPersisted}`);
            }

            // DB confirmation
            const dbCheck = await db.query(
              `SELECT u.name, dp."whatsappGroup" FROM users u JOIN driver_profiles dp ON dp."userId" = u.id WHERE u.id = $1`,
              [driverUserId]
            );
            log(`  DB check: name=${dbCheck.rows[0]?.name}, whatsapp=${dbCheck.rows[0]?.whatsappGroup}`);
          }
        }
      }
      await ctx.close();
    }

    // ================================================================
    // SCENARIO 2: SUPERVISOR requests deactivation via UI → PENDING
    // ================================================================
    log("=== Scenario 2: Supervisor requests deactivation via UI ===");
    {
      const ctx = await createContextWithToken(browser, supToken, 1440);
      const page = await ctx.newPage();
      await page.goto(`${PROD_URL}/drivers?status=all`, { waitUntil: "networkidle", timeout: 30000 });

      const searchInput = page.locator('input[aria-label="Buscar motorista"]');
      await searchInput.fill(FIXTURES.driverEmail);
      await page.waitForTimeout(500);

      // Click Desativar button
      const deactivateBtn = page.locator('button:has-text("Desativar")').first();
      const btnCount = await deactivateBtn.count();
      if (btnCount === 0) {
        record("S2", "FAIL", "Desativar button not found");
        await ctx.close();
      } else {
        await deactivateBtn.click();
        await page.waitForTimeout(500);

        // Verify deactivation modal opened with "Solicitar Desativação" title (supervisor view)
        const modalTitle = page.locator('h2:has-text("Solicitar Desativação")');
        const isRequestMode = await modalTitle.count() > 0;

        // Screenshot of deactivation modal in supervisor view
        screenshots.push(await takeScreenshot(page, "modal-deactivation-supervisor", 1440));

        // Fill reason (required for supervisor)
        const reasonTextarea = page.locator('.fixed.inset-0 textarea');
        await reasonTextarea.fill("Motivo de teste via UI");

        // Click "Enviar Solicitação"
        const submitBtn = page.locator('.fixed.inset-0 button:has-text("Enviar Solicitação")');
        await submitBtn.click();
        await page.waitForTimeout(2000);

        // Reload and check driver is still active
        await page.reload({ waitUntil: "networkidle" });
        await searchInput.fill(FIXTURES.driverEmail);
        await page.waitForTimeout(500);

        const activePill = page.locator('text=Ativo').first();
        const stillActive = await activePill.count() > 0;

        // DB check: PENDING request exists
        const pendingCheck = await db.query(
          `SELECT COUNT(*)::int AS c FROM deactivation_requests WHERE "driverUserId" = $1 AND status = 'PENDING'`,
          [driverUserId]
        );
        const pendingExists = pendingCheck.rows[0].c >= 1;

        if (isRequestMode && stillActive && pendingExists) {
          record("S2", "PASS", "Deactivation request created, driver stays active, PENDING in DB");
        } else {
          record("S2", "FAIL", `isRequestMode=${isRequestMode}, stillActive=${stillActive}, pendingExists=${pendingExists}`);
        }
      }
      await ctx.close();
    }

    // ================================================================
    // SCENARIO 3: SUPERVISOR tries second deactivation → blocked
    // ================================================================
    log("=== Scenario 3: Second deactivation request blocked ===");
    {
      const ctx = await createContextWithToken(browser, supToken, 1440);
      const page = await ctx.newPage();
      await page.goto(`${PROD_URL}/drivers?status=all`, { waitUntil: "networkidle", timeout: 30000 });

      const searchInput = page.locator('input[aria-label="Buscar motorista"]');
      await searchInput.fill(FIXTURES.driverEmail);
      await page.waitForTimeout(500);

      // Try to click Desativar again
      const deactivateBtn = page.locator('button:has-text("Desativar")').first();
      const btnCount = await deactivateBtn.count();

      if (btnCount === 0) {
        // Button not shown = driver already has pending request or is inactive
        // This is acceptable blocking behavior
        record("S3", "PASS", "Desativar button not available (blocked)");
      } else {
        await deactivateBtn.click();
        await page.waitForTimeout(500);

        const reasonTextarea = page.locator('.fixed.inset-0 textarea');
        await reasonTextarea.fill("Segunda tentativa");

        const submitBtn = page.locator('.fixed.inset-0 button:has-text("Enviar Solicitação")');
        await submitBtn.click();
        await page.waitForTimeout(2000);

        // Check for error toast
        const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: /erro|error/i });
        const hasError = await errorToast.count() > 0;

        // DB check: still only one PENDING
        const pendingCheck = await db.query(
          `SELECT COUNT(*)::int AS c FROM deactivation_requests WHERE "driverUserId" = $1 AND status = 'PENDING'`,
          [driverUserId]
        );
        const onlyOne = pendingCheck.rows[0].c === 1;

        if (hasError || onlyOne) {
          record("S3", "PASS", `Second request blocked. Error toast: ${hasError}, Only one PENDING: ${onlyOne}`);
        } else {
          record("S3", "FAIL", `Second request may have succeeded. PENDING count: ${pendingCheck.rows[0].c}`);
        }
      }
      await ctx.close();
    }

    // ================================================================
    // SCENARIO 4: ACCOUNT_MANAGER approves deactivation via UI
    // ================================================================
    log("=== Scenario 4: Account Manager approves deactivation via UI ===");
    {
      const ctx = await createContextWithToken(browser, amToken, 1440);
      const page = await ctx.newPage();
      await page.goto(`${PROD_URL}/drivers/deactivation-requests`, { waitUntil: "networkidle", timeout: 30000 });

      // Screenshot of deactivation requests page
      screenshots.push(await takeScreenshot(page, "deactivation-requests-pending", 1440));

      // Find the pending request for our driver (name was changed in S1 to "Verify Edited Name UI")
      // Log page content for debugging
      const pageContent = await page.textContent('body');
      log(`  Page contains 'Verify Edited Name UI': ${pageContent?.includes('Verify Edited Name UI')}`);
      log(`  Page contains 'Pendente': ${pageContent?.includes('Pendente')}`);
      log(`  Page contains 'Nenhuma solicitação': ${pageContent?.includes('Nenhuma solicitação')}`);
      
      // Search by email which is stable
      const driverEmailInList = page.getByText(FIXTURES.driverEmail, { exact: false });
      const found = await driverEmailInList.count() > 0;

      if (!found) {
        record("S4", "FAIL", "Pending request not found on deactivation-requests page");
        await ctx.close();
      } else {
        // Click "Revisar" button for our driver
        const reviewBtn = page.locator('button:has-text("Revisar")').first();
        await reviewBtn.click();
        await page.waitForTimeout(500);

        // Click "Aprovar e Desativar"
        const approveBtn = page.locator('button:has-text("Aprovar e Desativar")');
        await approveBtn.click();
        await page.waitForTimeout(2000);

        // Navigate to inactive drivers
        await page.goto(`${PROD_URL}/drivers?status=inactive`, { waitUntil: "networkidle", timeout: 30000 });

        // Screenshot of inactive list
        screenshots.push(await takeScreenshot(page, "drivers-inactive", 1440));

        // Search for our driver
        const searchInput = page.locator('input[aria-label="Buscar motorista"]');
        await searchInput.fill(FIXTURES.driverEmail);
        await page.waitForTimeout(500);

        const inactivePill = page.locator('text=Inativo').first();
        const isInactive = await inactivePill.count() > 0;

        // DB check
        const dbCheck = await db.query(
          `SELECT active, "deactivatedByRole" FROM users WHERE id = $1`,
          [driverUserId]
        );
        const dbInactive = dbCheck.rows[0]?.active === false;
        const dbRole = dbCheck.rows[0]?.deactivatedByRole === "ACCOUNT_MANAGER";

        if (isInactive && dbInactive && dbRole) {
          record("S4", "PASS", "Driver inactive in UI and DB, deactivatedByRole=ACCOUNT_MANAGER");
        } else {
          record("S4", "FAIL", `UI inactive=${isInactive}, DB active=${dbCheck.rows[0]?.active}, role=${dbCheck.rows[0]?.deactivatedByRole}`);
        }
      }
      await ctx.close();
    }

    // ================================================================
    // SCENARIO 5: ACCOUNT_MANAGER reactivates and marks as Trusted
    // ================================================================
    log("=== Scenario 5: AM reactivates and marks Trusted via UI ===");
    {
      const ctx = await createContextWithToken(browser, amToken, 1440);
      const page = await ctx.newPage();
      await page.goto(`${PROD_URL}/drivers?status=inactive`, { waitUntil: "networkidle", timeout: 30000 });

      const searchInput = page.locator('input[aria-label="Buscar motorista"]');
      await searchInput.fill(FIXTURES.driverEmail);
      await page.waitForTimeout(500);

      // Click Reativar
      const reactivateBtn = page.locator('button:has-text("Reativar")').first();
      const btnCount = await reactivateBtn.count();
      if (btnCount === 0) {
        record("S5", "FAIL", "Reativar button not found");
        await ctx.close();
      } else {
        await reactivateBtn.click();
        await page.waitForTimeout(2000);

        // Reload to see active driver
        await page.goto(`${PROD_URL}/drivers?status=all`, { waitUntil: "networkidle", timeout: 30000 });
        await searchInput.fill(FIXTURES.driverEmail);
        await page.waitForTimeout(500);

        // Click edit to mark as trusted (name was changed in S1)
        const editBtn = page.locator('button[aria-label^="Editar "]').first();
        await editBtn.click();
        await page.waitForTimeout(500);

        // Check the "Favorito (Confiança)" checkbox
        // Base UI Checkbox renders as <button role="checkbox"> inside a <label>
        const favLabel = page.locator('.fixed.inset-0 label:has-text("Favorito")');
        if (await favLabel.count() > 0) {
          // Click the label or the button[role="checkbox"] within it
          const checkboxBtn = favLabel.locator('[role="checkbox"]').first();
          if (await checkboxBtn.count() > 0) {
            const isChecked = await checkboxBtn.getAttribute("data-checked") === "" || 
                              await checkboxBtn.getAttribute("aria-checked") === "true";
            if (!isChecked) {
              await checkboxBtn.click();
              log("  Checked Favorito checkbox");
            } else {
              log("  Favorito already checked");
            }
          } else {
            // Fallback: click the label itself
            await favLabel.click();
            log("  Clicked Favorito label");
          }
        }
        await page.waitForTimeout(300);

        // Save
        const saveBtn = page.locator('.fixed.inset-0 button:has-text("Salvar")');
        await saveBtn.click();
        await page.waitForTimeout(2000);

        // Reload and verify
        await page.reload({ waitUntil: "networkidle" });
        await searchInput.fill(FIXTURES.driverEmail);
        await page.waitForTimeout(500);

        // Check for yellow star (trusted indicator)
        const trustedStar = page.locator('svg.fill-yellow-400').first();
        const hasTrustedStar = await trustedStar.count() > 0;

        // DB check
        const dbCheck = await db.query(
          `SELECT "isTrusted" FROM driver_profiles WHERE "userId" = $1`,
          [driverUserId]
        );
        const dbTrusted = dbCheck.rows[0]?.isTrusted === true;

        if (hasTrustedStar && dbTrusted) {
          record("S5", "PASS", "Trusted flag persists in UI and DB");
        } else {
          record("S5", "FAIL", `UI star=${hasTrustedStar}, DB isTrusted=${dbCheck.rows[0]?.isTrusted}`);
        }
      }
      await ctx.close();
    }

    // ================================================================
    // SCENARIO 6: Cross-company isolation
    // ================================================================
    log("=== Scenario 6: Cross-company isolation ===");
    {
      if (!otherSupToken) {
        record("S6", "SKIP", "No second transport company available");
      } else {
        const ctx = await createContextWithToken(browser, otherSupToken, 1440);
        const page = await ctx.newPage();
        await page.goto(`${PROD_URL}/drivers?status=all`, { waitUntil: "networkidle", timeout: 30000 });

        // Search for our driver (belongs to first company)
        const searchInput = page.locator('input[aria-label="Buscar motorista"]');
        await searchInput.fill(FIXTURES.driverEmail);
        await page.waitForTimeout(500);

        // Check if driver appears in results
        const driverRow = page.locator(`text=${FIXTURES.driverEmail}`);
        const driverVisible = await driverRow.count() > 0;

        // Also check the count text
        const countText = page.locator('text=Mostrando').first();
        const countContent = await countText.textContent().catch(() => "");

        if (!driverVisible) {
          record("S6", "PASS", `Driver not visible to other company supervisor. Count: ${countContent}`);
        } else {
          // Driver is visible - try to edit and see if it fails
          const editBtn = page.locator('button[aria-label^="Editar "]').first();
          const canEdit = await editBtn.count() > 0;
          if (canEdit) {
            await editBtn.click();
            await page.waitForTimeout(500);
            // Try to save a change
            const nameInput = page.locator('.fixed.inset-0 input').first();
            await nameInput.fill("Hacked Name");
            const saveBtn = page.locator('.fixed.inset-0 button:has-text("Salvar")');
            await saveBtn.click();
            await page.waitForTimeout(2000);

            // Check for error
            const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: /erro|error/i });
            const hasError = await errorToast.count() > 0;

            // DB check: name should NOT have changed
            const dbCheck = await db.query(`SELECT name FROM users WHERE id = $1`, [driverUserId]);
            const nameUnchanged = dbCheck.rows[0]?.name !== "Hacked Name";

            if (hasError && nameUnchanged) {
              record("S6", "PASS", "Edit blocked: error shown and name unchanged in DB");
            } else if (nameUnchanged) {
              record("S6", "PASS", "Name unchanged in DB even without visible error");
            } else {
              record("S6", "FAIL", `Cross-company edit succeeded! Name is now: ${dbCheck.rows[0]?.name}`);
            }
          } else {
            record("S6", "PASS", "Driver visible but edit button not available");
          }
        }
        await ctx.close();
      }
    }

    // ================================================================
    // SCENARIO 7: External deactivation cancels PENDING request
    // ================================================================
    log("=== Scenario 7: External deactivation cancels PENDING ===");
    {
      // First, ensure driver is active and create a new PENDING request via UI
      // Reactivate driver via DB first (to reset state)
      await db.query(`UPDATE users SET active = true, "deactivatedById" = null, "deactivatedByRole" = null WHERE id = $1`, [driverUserId]);
      // Clear any existing pending requests
      await db.query(`UPDATE deactivation_requests SET status = 'REJECTED' WHERE "driverUserId" = $1 AND status = 'PENDING'`, [driverUserId]);

      // Create PENDING request via UI as supervisor
      const supCtx = await createContextWithToken(browser, supToken, 1440);
      const supPage = await supCtx.newPage();
      await supPage.goto(`${PROD_URL}/drivers?status=all`, { waitUntil: "networkidle", timeout: 30000 });

      const searchInput = supPage.locator('input[aria-label="Buscar motorista"]');
      await searchInput.fill(FIXTURES.driverEmail);
      await supPage.waitForTimeout(500);

      const deactivateBtn = supPage.locator('button:has-text("Desativar")').first();
      if (await deactivateBtn.count() > 0) {
        await deactivateBtn.click();
        await supPage.waitForTimeout(500);
        const reasonTextarea = supPage.locator('.fixed.inset-0 textarea');
        await reasonTextarea.fill("Pedido para teste de cancelamento");
        const submitBtn = supPage.locator('.fixed.inset-0 button:has-text("Enviar Solicitação")');
        await submitBtn.click();
        await supPage.waitForTimeout(2000);
      }
      await supCtx.close();

      // Verify PENDING exists
      const pendingBefore = await db.query(
        `SELECT COUNT(*)::int AS c FROM deactivation_requests WHERE "driverUserId" = $1 AND status = 'PENDING'`,
        [driverUserId]
      );
      log(`  PENDING before external deactivation: ${pendingBefore.rows[0].c}`);

      if (pendingBefore.rows[0].c === 0) {
        record("S7", "FAIL", "Could not create PENDING request for scenario 7");
      } else {
        // Deactivate directly via AM on /drivers page (AM canDeactivateDirectly = true)
        // This exercises the requestDriverDeactivation → $transaction → cancelPendingDeactivationRequests path
        const amCtx2 = await createContextWithToken(browser, amToken, 1440);
        const amPage = await amCtx2.newPage();
        await amPage.goto(`${PROD_URL}/drivers?status=all`, { waitUntil: "networkidle", timeout: 30000 });
        const amSearch = amPage.locator('input[aria-label="Buscar motorista"]');
        await amSearch.fill(FIXTURES.driverEmail);
        await amPage.waitForTimeout(500);

        const amDeactivateBtn = amPage.locator('button:has-text("Desativar")').first();
        const amBtnCount = await amDeactivateBtn.count();
        log(`  AM deactivate button count: ${amBtnCount}`);
        if (amBtnCount > 0) {
          await amDeactivateBtn.click();
          await amPage.waitForTimeout(500);
          // AM sees "Desativar Motorista" (direct), not "Solicitar"
          const amModalTitle = amPage.locator('h2:has-text("Desativar Motorista")');
          const isDirectMode = await amModalTitle.count() > 0;
          log(`  AM modal direct mode: ${isDirectMode}`);
          const amReason = amPage.locator('.fixed.inset-0 textarea');
          await amReason.fill("Desativação direta pelo AM para teste");
          const amSubmit = amPage.locator('.fixed.inset-0 button:has-text("Desativar")');
          const amSubmitCount = await amSubmit.count();
          log(`  AM submit button count: ${amSubmitCount}`);
          if (amSubmitCount > 0) {
            await amSubmit.click();
            await amPage.waitForTimeout(3000);
            // Check for success toast
            const amToasts = amPage.locator('[data-sonner-toast]');
            const amToastCount = await amToasts.count();
            log(`  AM toast count after deactivate: ${amToastCount}`);
            for (let i = 0; i < amToastCount; i++) {
              const toastText = await amToasts.nth(i).textContent();
              log(`  AM Toast ${i}: ${toastText}`);
            }
          }
        }
        await amCtx2.close();

        // Check if PENDING was auto-cancelled
        const pendingAfter = await db.query(
          `SELECT COUNT(*)::int AS c FROM deactivation_requests WHERE "driverUserId" = $1 AND status = 'PENDING'`,
          [driverUserId]
        );
        const cancelled = pendingAfter.rows[0].c === 0;

        // Also check if there's a REJECTED/CANCELLED entry
        const rejectedCheck = await db.query(
          `SELECT status, "reviewNotes" FROM deactivation_requests WHERE "driverUserId" = $1 ORDER BY "createdAt" DESC LIMIT 3`,
          [driverUserId]
        );
        log(`  Recent requests: ${JSON.stringify(rejectedCheck.rows)}`);

        if (cancelled) {
          record("S7", "PASS", "PENDING request auto-cancelled after external deactivation");
        } else {
          record("S7", "FAIL", `PENDING still exists: ${pendingAfter.rows[0].c}`);
        }
      }
    }

    // ================================================================
    // SCENARIO 8: GNV column toggle
    // ================================================================
    log("=== Scenario 8: GNV column toggle ===");
    {
      // Ensure driver is active
      await db.query(`UPDATE users SET active = true WHERE id = $1`, [driverUserId]);

      const ctx = await createContextWithToken(browser, supToken, 1440);
      const page = await ctx.newPage();
      await page.goto(`${PROD_URL}/drivers?status=all`, { waitUntil: "networkidle", timeout: 30000 });

      // Screenshot of active drivers with GNV column
      screenshots.push(await takeScreenshot(page, "drivers-active-gnv", 1440));

      const searchInput = page.locator('input[aria-label="Buscar motorista"]');
      await searchInput.fill(FIXTURES.driverEmail);
      await page.waitForTimeout(500);

      // Find GNV checkbox for our driver (name may have changed)
      // The GNV checkbox has aria-label starting with "Marcar GNV para"
      // Base UI renders it as a button with the aria-label
      const gnvCheckbox = page.locator('[aria-label^="Marcar GNV para"]').first();
      const gnvCount = await gnvCheckbox.count();
      log(`  GNV checkbox count: ${gnvCount}`);
      
      if (gnvCount === 0) {
        // Try alternative: find by role
        const gnvByRole = page.getByRole('checkbox', { name: /Marcar GNV para/ }).first();
        const gnvRoleCount = await gnvByRole.count();
        log(`  GNV by role count: ${gnvRoleCount}`);
        if (gnvRoleCount > 0) {
          // Use this instead
          const currentState = await gnvByRole.getAttribute("data-state") || await gnvByRole.getAttribute("aria-checked");
          log(`  GNV initial state (by role): ${currentState}`);
          
          await gnvByRole.click();
          await page.waitForTimeout(2000);
          await page.reload({ waitUntil: "networkidle" });
          await searchInput.fill(FIXTURES.driverEmail);
          await page.waitForTimeout(500);
          
          const gnvAfterOn = page.getByRole('checkbox', { name: /Marcar GNV para/ }).first();
          const stateAfterOn = await gnvAfterOn.getAttribute("data-state") || await gnvAfterOn.getAttribute("aria-checked");
          
          const dbCheck = await db.query(
            `SELECT "hasGnv" FROM driver_profiles WHERE "userId" = $1`,
            [driverUserId]
          );
          const dbGnv = dbCheck.rows[0]?.hasGnv;
          log(`  DB hasGnv after toggle ON: ${dbGnv}`);
          
          if ((stateAfterOn === "checked" || stateAfterOn === "true") && dbGnv === true) {
            await gnvAfterOn.click();
            await page.waitForTimeout(2000);
            await page.reload({ waitUntil: "networkidle" });
            await searchInput.fill(FIXTURES.driverEmail);
            await page.waitForTimeout(500);
            
            const gnvAfterOff = page.getByRole('checkbox', { name: /Marcar GNV para/ }).first();
            const stateAfterOff = await gnvAfterOff.getAttribute("data-state") || await gnvAfterOff.getAttribute("aria-checked");
            
            const dbCheck2 = await db.query(
              `SELECT "hasGnv" FROM driver_profiles WHERE "userId" = $1`,
              [driverUserId]
            );
            const dbGnvOff = dbCheck2.rows[0]?.hasGnv;
            log(`  DB hasGnv after toggle OFF: ${dbGnvOff}`);
            
            if ((stateAfterOff !== "checked" && stateAfterOff !== "true") && dbGnvOff !== true) {
              record("S8", "PASS", "GNV toggle works both ways, persists in DB");
            } else {
              record("S8", "FAIL", `GNV OFF failed: state=${stateAfterOff}, DB=${dbGnvOff}`);
            }
          } else {
            record("S8", "FAIL", `GNV ON failed: state=${stateAfterOn}, DB=${dbGnv}`);
          }
          await ctx.close();
          // Skip the rest of S8
        } else {
          record("S8", "FAIL", "GNV checkbox not found by any method");
          await ctx.close();
        }
      } else {
        // Check current state using aria-checked (Base UI uses this)
        const currentState = await gnvCheckbox.getAttribute("aria-checked");
        log(`  GNV initial aria-checked: ${currentState}`);

        // Toggle ON
        await gnvCheckbox.click();
        await page.waitForTimeout(2000);

        // Reload and verify
        await page.reload({ waitUntil: "networkidle" });
        await searchInput.fill(FIXTURES.driverEmail);
        await page.waitForTimeout(500);

        const gnvAfterOn = page.locator('[aria-label^="Marcar GNV para"]').first();
        const stateAfterOn = await gnvAfterOn.getAttribute("aria-checked");
        log(`  GNV after ON aria-checked: ${stateAfterOn}`);

        // DB check - hasGnv is derived from vehicle_restrictions table
        const dbCheck = await db.query(
          `SELECT COUNT(*)::int AS c FROM vehicle_restrictions WHERE "driverProfileId" = (SELECT id FROM driver_profiles WHERE "userId" = $1)`,
          [driverUserId]
        );
        const dbGnv = dbCheck.rows[0]?.c > 0;
        log(`  DB hasGnv after toggle ON: ${dbGnv} (restrictions count: ${dbCheck.rows[0]?.c})`);

        if (stateAfterOn === "true" && dbGnv === true) {
          // Now toggle OFF
          await gnvAfterOn.click();
          await page.waitForTimeout(2000);
          await page.reload({ waitUntil: "networkidle" });
          await searchInput.fill(FIXTURES.driverEmail);
          await page.waitForTimeout(500);

          const gnvAfterOff = page.locator('[aria-label^="Marcar GNV para"]').first();
          const stateAfterOff = await gnvAfterOff.getAttribute("aria-checked");
          log(`  GNV after OFF aria-checked: ${stateAfterOff}`);

          const dbCheck2 = await db.query(
            `SELECT COUNT(*)::int AS c FROM vehicle_restrictions WHERE "driverProfileId" = (SELECT id FROM driver_profiles WHERE "userId" = $1)`,
            [driverUserId]
          );
          const dbGnvOff = dbCheck2.rows[0]?.c > 0;
          log(`  DB hasGnv after toggle OFF: ${dbGnvOff} (restrictions count: ${dbCheck2.rows[0]?.c})`);

          if (stateAfterOff !== "true" && dbGnvOff !== true) {
            record("S8", "PASS", "GNV toggle works both ways, persists in DB");
          } else {
            record("S8", "FAIL", `GNV OFF failed: state=${stateAfterOff}, DB=${dbGnvOff}`);
          }
        } else {
          record("S8", "FAIL", `GNV ON failed: aria-checked=${stateAfterOn}, DB=${dbGnv}`);
        }
      }
      await ctx.close();
    }

    // ================================================================
    // SCREENSHOTS at 390px (mobile)
    // ================================================================
    log("=== Mobile screenshots (390px) ===");
    {
      const ctx = await createContextWithToken(browser, supToken, 390);
      const page = await ctx.newPage();

      await page.goto(`${PROD_URL}/drivers?status=active`, { waitUntil: "networkidle", timeout: 30000 });
      screenshots.push(await takeScreenshot(page, "drivers-active-mobile", 390));

      await page.goto(`${PROD_URL}/drivers?status=inactive`, { waitUntil: "networkidle", timeout: 30000 });
      screenshots.push(await takeScreenshot(page, "drivers-inactive-mobile", 390));

      // Open edit modal at mobile width
      const searchInput = page.locator('input[aria-label="Buscar motorista"]');
      await searchInput.fill(FIXTURES.driverEmail);
      await page.waitForTimeout(500);
      const editBtn = page.locator('button[aria-label^="Editar "]').first();
      if (await editBtn.count() > 0) {
        await editBtn.click();
        await page.waitForTimeout(500);
        screenshots.push(await takeScreenshot(page, "modal-edit-mobile", 390));
      }

      await ctx.close();
    }

  } finally {
    await browser.close();
  }

  return screenshots;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  await db.connect();

  const beforeSnapshot = await snapshot();
  log(`Baseline counts: ${JSON.stringify(beforeSnapshot)}`);

  let fixtureData;
  let screenshots = [];
  try {
    fixtureData = await setupFixtures();
    const afterSetup = await snapshot();
    log(`After fixture creation: ${JSON.stringify(afterSetup)}`);

    screenshots = await runScenarios(fixtureData);
  } finally {
    await cleanupFixtures();
  }

  const afterSnapshot = await snapshot();
  log(`After cleanup: ${JSON.stringify(afterSnapshot)}`);

  const residueCount = await countVerifyProd();
  record("Cleanup: No __verify_prod_ residue", residueCount === 0 ? "PASS" : "FAIL", `Found ${residueCount}`);

  const tables = ["users", "driver_profiles", "deactivation_requests", "region_city_preferences"];
  let allMatch = true;
  for (const t of tables) {
    const before = beforeSnapshot[t];
    const after = afterSnapshot[t];
    const match = before === after;
    if (!match) allMatch = false;
    log(`  ${t}: before=${before}, after=${after} ${match ? "OK" : "MISMATCH"}`);
  }
  record("Cleanup: All counts match baseline", allMatch ? "PASS" : "FAIL",
    allMatch ? "" : `Before: ${JSON.stringify(beforeSnapshot)}, After: ${JSON.stringify(afterSnapshot)}`
  );

  log(`\n========== RESULTS ==========`);
  log(`Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
  for (const r of results) {
    log(`  ${r.status}: ${r.test}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
  for (const s of screenshots) {
    log(`  ${s}`);
  }

  await db.end();

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
