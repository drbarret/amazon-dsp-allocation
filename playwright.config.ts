import { defineConfig } from "playwright/test";

/**
 * Minimal Playwright config for layout-geometry regression tests.
 *
 * These tests measure REAL rendered geometry (getBoundingClientRect,
 * scrollWidth) in a real browser — jsdom cannot compute layout, so this
 * cannot be a vitest/jsdom test. They require:
 *   - a reachable Postgres (DATABASE_URL) to create a disposable user
 *   - AUTH_SECRET to forge an Auth.js session cookie
 *   - a running app (the webServer block below starts `next dev` on :3100)
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
  },
});
