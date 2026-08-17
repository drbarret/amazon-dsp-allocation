/**
 * Magic link login UI/E2E tests (real browser, no real e-mail sent).
 *
 * Why this exists: the login page now supports two tabs (Amazon and E-mail).
 * These tests assert the magic-link UI path in a real browser. No Resend API
 * key is required and no real e-mail is dispatched during these tests.
 *
 * The actual authorization logic (ACTIVE/BLOCKED/REVOKED/UNKNOWN, role
 * promotion, no demotion, Amazon compatibility) is covered by unit/integration
 * tests in src/lib/__tests__ because E2E cannot safely trigger a real e-mail
 * send without a valid Resend API key.
 *
 * Opt out explicitly with SKIP_E2E_TESTS=1 (CI without a running app).
 */
import { test, expect } from "playwright/test";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const SKIP_E2E = (process.env.SKIP_E2E_TESTS ?? "").trim() === "1";
const BASE_URL = process.env.E2E_BASE_URL ?? "";

test.describe("magic link login UI", () => {
  test.skip(SKIP_E2E, "SKIP_E2E_TESTS=1 set — explicit opt-out");

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 30_000 });
  });

  test("login page shows Amazon and E-mail tabs", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^Amazon$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^E-mail$/i })).toBeVisible();
  });

  test("E-mail tab renders the magic link form", async ({ page }) => {
    await page.getByRole("button", { name: /^E-mail$/i }).click();

    await expect(page.getByLabel(/E-mail/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Receber link de acesso/i })).toBeVisible();
    await expect(page.getByText(/Receba um link mágico/i)).toBeVisible();
  });

  test("submitting the e-mail form enters loading state", async ({ page }) => {
    await page.getByRole("button", { name: /^E-mail$/i }).click();
    await page.getByLabel(/E-mail/i).fill("test@instalog.com.br");

    const submitButton = page.getByRole("button", { name: /Receber link de acesso/i });
    await submitButton.click();

    // The button should become disabled while signIn is in flight.
    await expect(submitButton).toBeDisabled();
  });
});
