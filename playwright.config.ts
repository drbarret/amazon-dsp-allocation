import { defineConfig } from "playwright/test";

/**
 * Playwright config for E2E tests.
 *
 * These tests run against a real browser and a real Next.js dev server. They
 * require:
 *   - a reachable Postgres (DATABASE_URL) to create disposable users
 *   - AUTH_SECRET to forge an Auth.js session cookie
 *   - AUTH_URL set to the local dev server URL so Auth.js redirects stay on
 *     the same origin during tests (see webServer.env below).
 *
 * Deliberate opt-out (CI without a database): set SKIP_E2E_TESTS=1 and the
 * specs skip explicitly instead of silently passing.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
  },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      // Keep Auth.js redirects on the local E2E origin. Without this, the
      // signIn callback redirect URL would use the production AUTH_URL.
      AUTH_URL: "http://localhost:3100",
    },
  },
});
