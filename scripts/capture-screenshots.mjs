#!/usr/bin/env node
// DEVELOPMENT-ONLY utility: capture screenshots for the Phase 1.6 review package.
// Creates a temporary test user, forges a JWT session cookie,
// captures all 8 screens at 1440x900 and 390x844, then cleans up.
// Usage: node scripts/capture-screenshots.mjs

import { chromium } from "playwright";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const AUTH_SECRET = process.env.AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = "http://localhost:3000";

if (!AUTH_SECRET || !DATABASE_URL) {
  console.error("AUTH_SECRET and DATABASE_URL must be set");
  process.exit(1);
}

const SCREENSHOT_DIR = join(process.cwd(), "docs", "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const { Client } = pg;
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

// ============================================================
// HELPERS
// ============================================================
function count(table) {
  return client.query(`SELECT COUNT(*)::int AS c FROM "${table}"`).then(r => r.rows[0].c);
}

async function snapshot() {
  return {
    users: await count("users"),
    allowed_emails: await count("allowed_emails"),
    audit_logs: await count("audit_logs"),
    driver_profiles: await count("driver_profiles"),
    vehicle_restrictions: await count("vehicle_restrictions"),
  };
}

// ============================================================
// Forge JWT token (same algorithm as Auth.js)
// ============================================================
async function forgeJWT(payload, salt) {
  const enc = "A256CBC-HS512";
  const saltBytes = new TextEncoder().encode(salt);
  const encryptionSecret = await hkdf(
    "sha256",
    AUTH_SECRET,
    saltBytes,
    `Auth.js Generated Encryption Key (${salt})`,
    64
  );
  const thumbprint = await calculateJwkThumbprint(
    { kty: "oct", k: base64url.encode(encryptionSecret) },
    "sha512"
  );
  const now = Math.floor(Date.now() / 1000);
  const token = await new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc, kid: thumbprint })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600) // 1 hour
    .setJti(randomUUID())
    .encrypt(encryptionSecret);
  return token;
}

// ============================================================
// INITIAL SNAPSHOT
// ============================================================
const initial = await snapshot();
console.log("INITIAL counts:", JSON.stringify(initial));

// ============================================================
// Create temporary test users
// ============================================================
const ADMIN_ID = "screenshot-admin-temp";
const ADMIN_EMAIL = "screenshot-admin@instalog.com.br";
const SUPERVISOR_ID = "screenshot-supervisor-temp";
const SUPERVISOR_EMAIL = "screenshot-supervisor@instalog.com.br";
const DRIVER_ID = "screenshot-driver-temp";
const DRIVER_EMAIL = "screenshot-driver@instalog.com.br";

// Clean up any leftovers
await client.query(`DELETE FROM "audit_logs" WHERE "actorId" IN ($1, $2, $3) OR "targetUserId" IN ($1, $2, $3)`, [ADMIN_ID, SUPERVISOR_ID, DRIVER_ID]);
await client.query(`DELETE FROM "vehicle_restrictions" WHERE "driverProfileId" IN (SELECT id FROM "driver_profiles" WHERE "userId" IN ($1, $2, $3))`, [ADMIN_ID, SUPERVISOR_ID, DRIVER_ID]);
await client.query(`DELETE FROM "driver_profiles" WHERE "userId" IN ($1, $2, $3)`, [ADMIN_ID, SUPERVISOR_ID, DRIVER_ID]);
await client.query(`DELETE FROM "allowed_emails" WHERE email IN ($1, $2, $3)`, [ADMIN_EMAIL, SUPERVISOR_EMAIL, DRIVER_EMAIL]);
await client.query(`DELETE FROM "users" WHERE id IN ($1, $2, $3)`, [ADMIN_ID, SUPERVISOR_ID, DRIVER_ID]);

// Create ADMIN user
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, 'Admin Temp', 'ADMIN', true, now(), now())`,
  [ADMIN_ID, ADMIN_EMAIL]
);
await client.query(
  `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), $1, 'ADMIN', 'ACTIVE', now(), now())`,
  [ADMIN_EMAIL]
);

// Create SUPERVISOR user
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, 'Supervisor Temp', 'SUPERVISOR', true, now(), now())`,
  [SUPERVISOR_ID, SUPERVISOR_EMAIL]
);
await client.query(
  `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), $1, 'SUPERVISOR', 'ACTIVE', now(), now())`,
  [SUPERVISOR_EMAIL]
);

// Create DRIVER user with completed onboarding
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, 'Driver Temp', 'DRIVER', true, now(), now())`,
  [DRIVER_ID, DRIVER_EMAIL]
);
await client.query(
  `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), $1, 'DRIVER', 'ACTIVE', now(), now())`,
  [DRIVER_EMAIL]
);
await client.query(
  `INSERT INTO "driver_profiles" ("id", "userId", "cpf", "cpfBlindIndex", "phone", "phoneFormatted", "vehicleType", "onboardingCompleted", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), $1, 'encrypted-cpf-driver', 'blind-index-driver', 'encrypted-phone', '(11) 99999-9999', 'CARGO_VAN', true, now(), now())`,
  [DRIVER_ID]
);

// Create sample drivers for the /drivers screen
const SAMPLE_DRIVERS = [
  { id: "screenshot-driver-1", email: "driver1.temp@instalog.com.br", name: "João Silva", cpf: "enc-cpf-1" },
  { id: "screenshot-driver-2", email: "driver2.temp@instalog.com.br", name: "Maria Oliveira", cpf: "enc-cpf-2" },
  { id: "screenshot-driver-3", email: "driver3.temp@instalog.com.br", name: "Carlos Santos", cpf: "enc-cpf-3" },
];

for (const d of SAMPLE_DRIVERS) {
  await client.query(`DELETE FROM "vehicle_restrictions" WHERE "driverProfileId" IN (SELECT id FROM "driver_profiles" WHERE "userId" = $1)`, [d.id]);
  await client.query(`DELETE FROM "driver_profiles" WHERE "userId" = $1`, [d.id]);
  await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [d.email]);
  await client.query(`DELETE FROM "users" WHERE id = $1`, [d.id]);

  await client.query(
    `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'DRIVER', true, now(), now())`,
    [d.id, d.email, d.name]
  );
  await client.query(
    `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'DRIVER', 'ACTIVE', now(), now())`,
    [d.email]
  );
  await client.query(
    `INSERT INTO "driver_profiles" ("id", "userId", "cpf", "cpfBlindIndex", "phone", "phoneFormatted", "vehicleType", "onboardingCompleted", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'encrypted-phone', '(11) 99999-9999', 'CARGO_VAN', true, now(), now())`,
    [d.id, d.cpf, `blind-${d.cpf}`]
  );
}

console.log("Test users created");

// ============================================================
// Forge JWT tokens for each role
// ============================================================
const cookieName = "authjs.session-token";
const salt = cookieName;

const adminToken = await forgeJWT({
  id: ADMIN_ID,
  email: ADMIN_EMAIL,
  name: "Admin Temp",
  role: "ADMIN",
  active: true,
  roleLastFetched: Date.now(),
}, salt);
console.log("adminToken type:", typeof adminToken, "length:", adminToken?.length);

const supervisorToken = await forgeJWT({
  id: SUPERVISOR_ID,
  email: SUPERVISOR_EMAIL,
  name: "Supervisor Temp",
  role: "SUPERVISOR",
  active: true,
  roleLastFetched: Date.now(),
}, salt);

const driverToken = await forgeJWT({
  id: DRIVER_ID,
  email: DRIVER_EMAIL,
  name: "Driver Temp",
  role: "DRIVER",
  active: true,
  roleLastFetched: Date.now(),
}, salt);

console.log("JWT tokens forged");

// ============================================================
// Playwright screenshot capture
// ============================================================
const browser = await chromium.launch({ headless: true });

async function captureScreen(url, token, filename, viewport) {
  const context = await browser.newContext({
    viewport,
    ignoreHTTPSErrors: true,
  });

  // Set the session cookie (only if token is provided)
  if (token) {
    await context.addCookies([{
      name: cookieName,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
  }

  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}${url}`, { waitUntil: "networkidle", timeout: 15000 });
    // Wait a bit for any client-side rendering
    await page.waitForTimeout(2000);
    const filepath = join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    console.log(`  Captured: ${filename}`);
  } catch (e) {
    console.error(`  FAILED: ${filename} — ${e.message}`);
    // Take a screenshot anyway to show what happened
    try {
      await page.screenshot({ path: join(SCREENSHOT_DIR, filename) });
    } catch {}
  } finally {
    await context.close();
  }
}

// ============================================================
// Capture all screens
// ============================================================
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

console.log("\nCapturing screenshots...");

for (const vp of VIEWPORTS) {
  const suffix = vp.name;

  // Unauthenticated pages (no token needed)
  await captureScreen("/", null, `landing-${suffix}.png`, { width: vp.width, height: vp.height });
  await captureScreen("/login", null, `login-${suffix}.png`, { width: vp.width, height: vp.height });
  await captureScreen("/forbidden", null, `forbidden-${suffix}.png`, { width: vp.width, height: vp.height });
  await captureScreen("/auth-error", null, `auth-error-${suffix}.png`, { width: vp.width, height: vp.height });

  // Onboarding (needs DRIVER without completed profile — use a fresh driver)
  // Actually, our DRIVER has onboardingCompleted=true, so they go to dashboard.
  // For onboarding screenshot, we need a driver without a profile.
  // Let's use a separate approach: create a driver without profile.
  const ONBOARDING_DRIVER_ID = "screenshot-onboarding-temp";
  const ONBOARDING_DRIVER_EMAIL = "screenshot-onboarding@instalog.com.br";
  await client.query(`DELETE FROM "driver_profiles" WHERE "userId" = $1`, [ONBOARDING_DRIVER_ID]);
  await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [ONBOARDING_DRIVER_EMAIL]);
  await client.query(`DELETE FROM "users" WHERE id = $1`, [ONBOARDING_DRIVER_ID]);
  await client.query(
    `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Onboarding Driver', 'DRIVER', true, now(), now())`,
    [ONBOARDING_DRIVER_ID, ONBOARDING_DRIVER_EMAIL]
  );
  await client.query(
    `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'DRIVER', 'ACTIVE', now(), now())`,
    [ONBOARDING_DRIVER_EMAIL]
  );
  const onboardingToken = await forgeJWT({
    id: ONBOARDING_DRIVER_ID,
    email: ONBOARDING_DRIVER_EMAIL,
    name: "Onboarding Driver",
    role: "DRIVER",
    active: true,
    roleLastFetched: Date.now(),
  }, salt);
  await captureScreen("/onboarding", onboardingToken, `onboarding-${suffix}.png`, { width: vp.width, height: vp.height });
  // Clean up onboarding driver
  await client.query(`DELETE FROM "driver_profiles" WHERE "userId" = $1`, [ONBOARDING_DRIVER_ID]);
  await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [ONBOARDING_DRIVER_EMAIL]);
  await client.query(`DELETE FROM "users" WHERE id = $1`, [ONBOARDING_DRIVER_ID]);

  // Dashboard (as ADMIN)
  await captureScreen("/dashboard", adminToken, `dashboard-${suffix}.png`, { width: vp.width, height: vp.height });

  // Admin Users (as ADMIN)
  await captureScreen("/admin/users", adminToken, `admin-users-${suffix}.png`, { width: vp.width, height: vp.height });

  // Drivers (as SUPERVISOR)
  await captureScreen("/drivers", supervisorToken, `drivers-${suffix}.png`, { width: vp.width, height: vp.height });
}

await browser.close();

// ============================================================
// CLEANUP
// ============================================================
console.log("\nCleaning up test data...");

// Remove sample drivers
for (const d of SAMPLE_DRIVERS) {
  await client.query(`DELETE FROM "vehicle_restrictions" WHERE "driverProfileId" IN (SELECT id FROM "driver_profiles" WHERE "userId" = $1)`, [d.id]);
  await client.query(`DELETE FROM "driver_profiles" WHERE "userId" = $1`, [d.id]);
  await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [d.email]);
  await client.query(`DELETE FROM "users" WHERE id = $1`, [d.id]);
}

// Remove main test users
await client.query(`DELETE FROM "audit_logs" WHERE "actorId" IN ($1, $2, $3) OR "targetUserId" IN ($1, $2, $3)`, [ADMIN_ID, SUPERVISOR_ID, DRIVER_ID]);
await client.query(`DELETE FROM "vehicle_restrictions" WHERE "driverProfileId" IN (SELECT id FROM "driver_profiles" WHERE "userId" IN ($1, $2, $3))`, [ADMIN_ID, SUPERVISOR_ID, DRIVER_ID]);
await client.query(`DELETE FROM "driver_profiles" WHERE "userId" IN ($1, $2, $3)`, [ADMIN_ID, SUPERVISOR_ID, DRIVER_ID]);
await client.query(`DELETE FROM "allowed_emails" WHERE email IN ($1, $2, $3)`, [ADMIN_EMAIL, SUPERVISOR_EMAIL, DRIVER_EMAIL]);
await client.query(`DELETE FROM "users" WHERE id IN ($1, $2, $3)`, [ADMIN_ID, SUPERVISOR_ID, DRIVER_ID]);

// ============================================================
// VERIFY RESTORATION
// ============================================================
const final = await snapshot();
console.log("\nFINAL counts:", JSON.stringify(final));

const restored = initial.users === final.users
  && initial.allowed_emails === final.allowed_emails
  && initial.audit_logs === final.audit_logs
  && initial.driver_profiles === final.driver_profiles
  && initial.vehicle_restrictions === final.vehicle_restrictions;

if (!restored) {
  console.error("FATAL: DB state NOT fully restored!");
  console.error("  INITIAL:", JSON.stringify(initial));
  console.error("  FINAL:  ", JSON.stringify(final));
  process.exit(1);
}
console.log("DB state fully restored.");

await client.end();
console.log("\nDone. Screenshots saved to docs/screenshots/");
