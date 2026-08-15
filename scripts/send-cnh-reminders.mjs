#!/usr/bin/env node
/**
 * Manual trigger for the CNH expiry reminder job.
 *
 * Calls the protected endpoint /api/cron/cnh-reminders with the CRON_SECRET
 * bearer token. This keeps a single source of truth (the server action) and
 * reuses the same protection as the Vercel cron schedule.
 *
 * Usage:
 *   node scripts/send-cnh-reminders.mjs            # send real reminders
 *   node scripts/send-cnh-reminders.mjs --dry-run  # simulate only
 *
 * Env:
 *   CRON_SECRET  — must match the server's CRON_SECRET.
 *   APP_URL      — base URL of the app (defaults to NEXT_PUBLIC_APP_URL or
 *                  http://localhost:3000).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
} catch {
  try {
    process.loadEnvFile(path.resolve(__dirname, "..", ".env"));
  } catch {
    // no env file; use shell vars
  }
}

const DRY_RUN = process.argv.includes("--dry-run");
const secret = process.env.CRON_SECRET?.trim();
const baseUrl =
  process.env.APP_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "http://localhost:3000";

if (!secret) {
  console.error("❌ CRON_SECRET não está definida.");
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}/api/cron/cnh-reminders${DRY_RUN ? "?dryRun=1" : ""}`;

console.log(`POST ${url} (${DRY_RUN ? "DRY-RUN" : "ENVIO REAL"})`);

const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.json().catch(() => ({}));
console.log(`Status: ${res.status}`);
console.log(JSON.stringify(body, null, 2));

if (!res.ok) {
  process.exit(1);
}
