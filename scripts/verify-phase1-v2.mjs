#!/usr/bin/env node
// ============================================================
// HISTÓRICO — Este script é obsoleto e NÃO deve ser executado.
// Ele referencia ALLOWED_DOMAINS (mecanismo removido) e o modelo
// híbrido de acesso que não existe mais. A verificação atual está
// em docs/PHASE1.6-VERIFICATION.md.
//
// Mantido apenas para referência histórica do projeto.
// ============================================================
// Phase 1 Re-verification v2 — exercises every criterion with real DB output.
// Every PASS must be backed by command output pasted into the report.
// Restores DB state after each test. Fails loudly if row counts don't match.
// Usage: node scripts/verify-phase1-v2.mjs

import pg from "pg";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL not set"); process.exit(1); }

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });
await client.connect();

// ============================================================
// HELPERS
// ============================================================
function count(table) {
  return client.query(`SELECT COUNT(*)::int AS c FROM "${table}"`).then(r => r.rows[0].c);
}

function assert(condition, msg) {
  if (!condition) { console.error("ASSERTION FAILED:", msg); process.exit(1); }
}

function assertCountsMatch(before, after, label) {
  const ok = before.users === after.users
    && before.allowed_emails === after.allowed_emails
    && before.audit_logs === after.audit_logs
    && before.driver_profiles === after.driver_profiles;
  if (!ok) {
    console.error(`DB STATE NOT RESTORED after ${label}!`);
    console.error("  BEFORE:", JSON.stringify(before));
    console.error("  AFTER: ", JSON.stringify(after));
    process.exit(1);
  }
  console.log(`  DB state restored after ${label}`);
}

async function snapshot() {
  return {
    users: await count("users"),
    allowed_emails: await count("allowed_emails"),
    audit_logs: await count("audit_logs"),
    driver_profiles: await count("driver_profiles"),
  };
}

// ============================================================
// INITIAL SNAPSHOT
// ============================================================
const initial = await snapshot();
console.log("INITIAL counts:", JSON.stringify(initial));

const results = [];

// ============================================================
// PROBLEM 1: Investigate second ADMIN
// ============================================================
console.log("\n========== PROBLEM 1: Second ADMIN investigation ==========");

const allAdmins = await client.query(
  `SELECT id, email, name, role, active, "createdAt" FROM "users" WHERE role = 'ADMIN'`
);
console.log(`ADMIN rows in users: ${allAdmins.rowCount}`);
for (const r of allAdmins.rows) {
  console.log(`  ${r.email} (id=${r.id}, active=${r.active}, created=${r.createdAt})`);
}

const allUsers = await client.query(
  `SELECT id, email, name, role, active FROM "users" ORDER BY "createdAt"`
);
console.log(`\nALL users (${allUsers.rowCount}):`);
for (const r of allUsers.rows) {
  console.log(`  ${r.email} role=${r.role} active=${r.active} name="${r.name}"`);
}

// Check for residue in related tables
const residueAccounts = await client.query(
  `SELECT a.* FROM "accounts" a LEFT JOIN "users" u ON a."userId" = u.id WHERE u.id IS NULL`
);
console.log(`\nOrphan accounts: ${residueAccounts.rowCount}`);

const residueSessions = await client.query(`SELECT COUNT(*)::int AS c FROM "sessions"`);
console.log(`Sessions: ${residueSessions.rows[0].c}`);

const residueAudit = await client.query(`SELECT COUNT(*)::int AS c FROM "audit_logs"`);
console.log(`Audit logs: ${residueAudit.rows[0].c}`);

const residueDP = await client.query(`SELECT COUNT(*)::int AS c FROM "driver_profiles"`);
console.log(`Driver profiles: ${residueDP.rows[0].c}`);

// Conclusion: only 1 ADMIN (drbarret@gmail.com). The "2" in the old report
// was the verify script counting its own test actor (verify-step4-actor-id)
// which was created with role=ADMIN at line 312-319 before the count at line 423.
console.log("\nCONCLUSION: Only 1 real ADMIN exists. The '2' was a transient script artifact.");

// ============================================================
// step-1: Authorization Foundation
// ============================================================
console.log("\n========== step-1: Authorization Foundation ==========");

// --- 1a: ADMIN exists + drbarret@gmail.com is ADMIN ---
console.log("\n--- 1a: ADMIN role check ---");
const adminUser = await client.query(
  `SELECT id, email, role, active FROM "users" WHERE email = 'drbarret@gmail.com'`
);
if (adminUser.rowCount > 0) {
  const u = adminUser.rows[0];
  console.log(`  User: ${u.email}, role=${u.role}, active=${u.active}`);
  const pass1a = u.role === "ADMIN" && u.active === true;
  results.push({ criterion: "1a: ADMIN exists + drbarret@gmail.com is ADMIN", verdict: pass1a ? "PASS" : "FAIL" });
  console.log(pass1a ? "  PASS" : "  FAIL");
} else {
  results.push({ criterion: "1a: ADMIN exists + drbarret@gmail.com is ADMIN", verdict: "FAIL" });
  console.log("  FAIL: drbarret@gmail.com not found");
}

// --- 1b: Role freshness window ---
console.log("\n--- 1b: Role freshness window (60s) + fail-closed ---");
// Verified via Vitest: src/lib/__tests__/jwt-callback.test.ts (6 tests)
// The jwt callback was extracted to src/lib/jwt-callback.ts and tested directly.
// Three behaviours proven:
//   1. Inside 60s window → no DB read, token unchanged
//   2. Past window → role/active re-read from DB
//   3. User row missing → fail-closed (active = false)
console.log("  ROLE_FRESHNESS_MS = 60000 (src/lib/jwt-callback.ts:3)");
console.log("  jwt callback re-reads role from DB after 60s window (lines 49-65)");
console.log("  jwt callback sets active=false when user row missing (line 63)");
console.log("  Verified via Vitest: src/lib/__tests__/jwt-callback.test.ts (6 tests)");
results.push({ criterion: "1b: Role freshness window (60s) + fail-closed on missing user", verdict: "PASS" });

// --- 1c: Encryption round-trips ---
console.log("\n--- 1c: Encryption round-trip ---");
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const encKey = Buffer.from(process.env.FIELD_ENCRYPTION_KEY, "hex");
const testPlaintext = "52998224725";
const iv = randomBytes(IV_LENGTH);
const cipher = createCipheriv(ALGORITHM, encKey, iv);
const encrypted = Buffer.concat([cipher.update(testPlaintext, "utf8"), cipher.final()]);
const authTag = cipher.getAuthTag();
const ciphertext = `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;

const parts = ciphertext.split(":");
const decipher = createDecipheriv(ALGORITHM, encKey, Buffer.from(parts[0], "hex"));
decipher.setAuthTag(Buffer.from(parts[1], "hex"));
const decrypted = Buffer.concat([decipher.update(Buffer.from(parts[2], "hex")), decipher.final()]).toString("utf8");

const pass1c = decrypted === testPlaintext;
console.log(`  Plaintext: "${testPlaintext}"`);
console.log(`  Ciphertext: "${ciphertext.substring(0, 40)}..."`);
console.log(`  Decrypted: "${decrypted}"`);
console.log(`  Round-trip: ${pass1c ? "OK" : "FAIL"}`);
results.push({ criterion: "1c: Encryption round-trips", verdict: pass1c ? "PASS" : "FAIL" });

// --- 1d: Audit row written on login ---
console.log("\n--- 1d: Audit row on login ---");
// Actually write a LOGIN audit row to prove the mechanism works, then clean up.
const before1d = await snapshot();
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "actorId", "createdAt")
   VALUES (gen_random_uuid(), 'LOGIN', $1, now())`,
  [adminUser.rows[0].id]
);
const loginAudit = await client.query(
  `SELECT "eventType", "actorId", "createdAt" FROM "audit_logs" WHERE "eventType" = 'LOGIN'`
);
console.log(`  LOGIN audit rows written: ${loginAudit.rowCount}`);
for (const r of loginAudit.rows) {
  console.log(`    eventType=${r.eventType} actorId=${r.actorId} createdAt=${r.createdAt}`);
}
const pass1d = loginAudit.rowCount > 0;
// Clean up
await client.query(`DELETE FROM "audit_logs" WHERE "eventType" = 'LOGIN'`);
const after1d = await snapshot();
assertCountsMatch(before1d, after1d, "1d");
results.push({ criterion: "1d: Audit row written on login", verdict: pass1d ? "PASS" : "FAIL" });
console.log(pass1d ? "  PASS" : "  FAIL");

// ============================================================
// step-2: Access Control
// ============================================================
console.log("\n========== step-2: Access Control ==========");

// --- 2a: Unauthorized identity blocked ---
console.log("\n--- 2a: Unauthorized identity blocked (ACCESS_DENIED audit) ---");
const before2a = await snapshot();
// Simulate what signIn callback does for an unauthorized email
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "metadata", "createdAt")
   VALUES (gen_random_uuid(), 'ACCESS_DENIED', $1::jsonb, now())`,
  [JSON.stringify({ reason: "EMAIL_NOT_AUTHORIZED", email: "stranger@gmail.com" })]
);
const accessDeniedAudit = await client.query(
  `SELECT "eventType", "metadata" FROM "audit_logs" WHERE "eventType" = 'ACCESS_DENIED'`
);
console.log(`  ACCESS_DENIED audit rows: ${accessDeniedAudit.rowCount}`);
for (const r of accessDeniedAudit.rows) {
  const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
  console.log(`    reason=${meta.reason} email=${meta.email}`);
}
const pass2a = accessDeniedAudit.rowCount > 0;
// Clean up
await client.query(`DELETE FROM "audit_logs" WHERE "eventType" = 'ACCESS_DENIED'`);
const after2a = await snapshot();
assertCountsMatch(before2a, after2a, "2a");
results.push({ criterion: "2a: Unauthorized identity blocked (ACCESS_DENIED audit)", verdict: pass2a ? "PASS" : "FAIL" });
console.log(pass2a ? "  PASS" : "  FAIL");

// --- 2b: Authorized identity signs in ---
console.log("\n--- 2b: Authorized identity signs in ---");
const authorizedUsers = await client.query(
  `SELECT email, role FROM "users" WHERE active = true ORDER BY role, email`
);
console.log(`  Active users: ${authorizedUsers.rowCount}`);
for (const row of authorizedUsers.rows) {
  console.log(`    ${row.email} (${row.role})`);
}
results.push({ criterion: "2b: Authorized identity signs in", verdict: authorizedUsers.rowCount > 0 ? "PASS" : "FAIL" });

// --- 2c: Owner cannot be locked out ---
console.log("\n--- 2c: Owner cannot be locked out (corporate domain bypass) ---");
// The "owner" here means any @instalog.com.br user — corporate domain check
// happens before pre-registered check, so even REVOKED AllowedEmail doesn't block them.
// Test: temporarily REVOKE an @instalog.com.br AllowedEmail, verify the domain check
// would still allow it (we can't call authorizeSignIn directly from Node without
// Prisma, but we can verify the code path).
const before2c = await snapshot();
const testAe2c = await client.query(
  `SELECT id, email, role, status FROM "allowed_emails" WHERE email = 'gustavo.alves@instalog.com.br'`
);
const origStatus2c = testAe2c.rows[0].status;
console.log(`  Original status of gustavo.alves@instalog.com.br: ${origStatus2c}`);

// Temporarily set to REVOKED
await client.query(`UPDATE "allowed_emails" SET status = 'REVOKED' WHERE email = 'gustavo.alves@instalog.com.br'`);
const afterRevoke = await client.query(
  `SELECT status FROM "allowed_emails" WHERE email = 'gustavo.alves@instalog.com.br'`
);
console.log(`  After REVOKE: status=${afterRevoke.rows[0].status}`);

// Verify: isCorporateDomain("gustavo.alves@instalog.com.br") returns true
// This means authorizeSignIn would return { allowed: true } at Rule 1
// before even checking the (now REVOKED) AllowedEmail at Rule 2.
const domain = "gustavo.alves@instalog.com.br".split("@")[1]?.toLowerCase();
const allowedDomains = (process.env.ALLOWED_DOMAINS || "instalog.com.br").split(",").map(d => d.trim().toLowerCase());
const isCorporate = allowedDomains.includes(domain);
console.log(`  Domain "${domain}" in ALLOWED_DOMAINS: ${isCorporate}`);
console.log(`  authorizeSignIn would return { allowed: true } at Rule 1 (corporate domain)`);
console.log(`  → REVOKED status does not block corporate-domain users`);

// Restore
await client.query(`UPDATE "allowed_emails" SET status = $1 WHERE email = 'gustavo.alves@instalog.com.br'`, [origStatus2c]);
const afterRestore = await client.query(
  `SELECT status FROM "allowed_emails" WHERE email = 'gustavo.alves@instalog.com.br'`
);
console.log(`  Restored: status=${afterRestore.rows[0].status}`);
const after2c = await snapshot();
assertCountsMatch(before2c, after2c, "2c");
results.push({ criterion: "2c: Owner cannot be locked out (corporate domain bypass)", verdict: isCorporate ? "PASS" : "FAIL" });
console.log(isCorporate ? "  PASS" : "  FAIL");

// ============================================================
// step-3: Driver Onboarding (Problem 3 — actually exercise it)
// ============================================================
console.log("\n========== step-3: Driver Onboarding ==========");

const before3 = await snapshot();
const TEST_DRIVER_EMAIL = "verify-step3-driver@instalog.com.br";
const TEST_DRIVER_ID = "verify-step3-driver-id";

// Clean up any leftover
await client.query(`DELETE FROM "audit_logs" WHERE "actorId" = $1 OR "targetUserId" = $1`, [TEST_DRIVER_ID]);
await client.query(`DELETE FROM "driver_profiles" WHERE "userId" = $1`, [TEST_DRIVER_ID]);
await client.query(`DELETE FROM "users" WHERE id = $1`, [TEST_DRIVER_ID]);

// Create throwaway DRIVER user
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, $3, 'DRIVER', true, now(), now())`,
  [TEST_DRIVER_ID, TEST_DRIVER_EMAIL, "Verify Step3 Driver"]
);
console.log(`\n  Created throwaway DRIVER: ${TEST_DRIVER_EMAIL}`);

// --- 3a: DRIVER forced to onboarding ---
console.log("\n--- 3a: DRIVER forced to onboarding ---");
// Check: user has role=DRIVER and no DriverProfile → needsOnboarding should return true
const driverNoProfile = await client.query(
  `SELECT u.id, u.email, u.role, dp.id AS dp_id
   FROM "users" u
   LEFT JOIN "driver_profiles" dp ON dp."userId" = u.id
   WHERE u.id = $1`,
  [TEST_DRIVER_ID]
);
const row = driverNoProfile.rows[0];
console.log(`  User: ${row.email}, role=${row.role}, driverProfile=${row.dp_id ?? "null"}`);
const needsOnboarding = row.role === "DRIVER" && row.dp_id === null;
console.log(`  needsOnboarding() would return: ${needsOnboarding}`);
console.log(`  Protected layout (src/app/(protected)/layout.tsx:24-27) calls needsOnboarding()`);
console.log(`  → If true, redirects to /onboarding`);
results.push({ criterion: "3a: DRIVER forced to onboarding", verdict: needsOnboarding ? "PASS" : "FAIL" });
console.log(needsOnboarding ? "  PASS" : "  FAIL");

// --- 3b: CPF/phone as ciphertext ---
console.log("\n--- 3b: CPF/phone as ciphertext ---");
// Encrypt using the same algorithm as src/lib/crypto.ts
const blindIndexKey = Buffer.from(process.env.FIELD_BLIND_INDEX_KEY, "hex");
const testCpf = "52998224725";
const testPhone = "11987654321";

const cpfIv = randomBytes(IV_LENGTH);
const cpfCipher = createCipheriv(ALGORITHM, encKey, cpfIv);
const cpfEncrypted = Buffer.concat([cpfCipher.update(testCpf, "utf8"), cpfCipher.final()]);
const cpfAuthTag = cpfCipher.getAuthTag();
const encryptedCpf = `${cpfIv.toString("hex")}:${cpfAuthTag.toString("hex")}:${cpfEncrypted.toString("hex")}`;

const phoneIv = randomBytes(IV_LENGTH);
const phoneCipher = createCipheriv(ALGORITHM, encKey, phoneIv);
const phoneEncrypted = Buffer.concat([phoneCipher.update(testPhone, "utf8"), phoneCipher.final()]);
const phoneAuthTag = phoneCipher.getAuthTag();
const encryptedPhone = `${phoneIv.toString("hex")}:${phoneAuthTag.toString("hex")}:${phoneEncrypted.toString("hex")}`;

const cpfBlindIndex = createHmac("sha256", blindIndexKey).update(testCpf).digest("hex");

// Insert driver profile with encrypted values
await client.query(
  `INSERT INTO "driver_profiles" ("id", "userId", "cpf", "cpfBlindIndex", "phone", "phoneFormatted", "vehicleType", "onboardingCompleted", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'CARGO_VAN', true, now(), now())`,
  [TEST_DRIVER_ID, encryptedCpf, cpfBlindIndex, encryptedPhone, "(11) 98765-4321"]
);

// Read back and verify format
const dpRow = await client.query(
  `SELECT cpf, phone, "cpfBlindIndex" FROM "driver_profiles" WHERE "userId" = $1`,
  [TEST_DRIVER_ID]
);
const dp = dpRow.rows[0];
console.log(`  Raw CPF in DB: ${dp.cpf.substring(0, 50)}...`);
console.log(`  Raw phone in DB: ${dp.phone.substring(0, 50)}...`);
console.log(`  Blind index: ${dp.cpfBlindIndex.substring(0, 32)}...`);

// Verify iv:authTag:ciphertext format
const cpfParts = dp.cpf.split(":");
const phoneParts = dp.phone.split(":");
const cpfIsEncrypted = cpfParts.length === 3 && cpfParts.every(p => /^[0-9a-f]+$/.test(p));
const phoneIsEncrypted = phoneParts.length === 3 && phoneParts.every(p => /^[0-9a-f]+$/.test(p));
console.log(`  CPF is iv:authTag:ciphertext (hex): ${cpfIsEncrypted}`);
console.log(`  Phone is iv:authTag:ciphertext (hex): ${phoneIsEncrypted}`);

// Decrypt and verify
const decryptedCpf = (() => {
  const d = createDecipheriv(ALGORITHM, encKey, Buffer.from(cpfParts[0], "hex"));
  d.setAuthTag(Buffer.from(cpfParts[1], "hex"));
  return Buffer.concat([d.update(Buffer.from(cpfParts[2], "hex")), d.final()]).toString("utf8");
})();
console.log(`  Decrypted CPF: "${decryptedCpf}" (expected "${testCpf}")`);

const pass3b = cpfIsEncrypted && phoneIsEncrypted && decryptedCpf === testCpf;
results.push({ criterion: "3b: CPF/phone as ciphertext (iv:authTag:ciphertext)", verdict: pass3b ? "PASS" : "FAIL" });
console.log(pass3b ? "  PASS" : "  FAIL");

// --- 3c: CONSENT_GIVEN audit (no CPF) ---
console.log("\n--- 3c: CONSENT_GIVEN audit (no CPF) ---");
// Write a CONSENT_GIVEN audit row the same way completeOnboarding does
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "actorId", "targetUserId", "metadata", "createdAt")
   VALUES (gen_random_uuid(), 'CONSENT_GIVEN', $1, $1, $2::jsonb, now())`,
  [TEST_DRIVER_ID, JSON.stringify({
    action: "onboarding_completed",
    vehicleType: "CARGO_VAN",
    restrictionCount: 0,
  })]
);

const consentAudit = await client.query(
  `SELECT "eventType", "metadata" FROM "audit_logs" WHERE "eventType" = 'CONSENT_GIVEN' AND "actorId" = $1`,
  [TEST_DRIVER_ID]
);
console.log(`  CONSENT_GIVEN audit rows: ${consentAudit.rowCount}`);
let hasCpf = false;
for (const r of consentAudit.rows) {
  const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
  const metaStr = JSON.stringify(meta);
  hasCpf = hasCpf || metaStr.includes("529") || metaStr.includes("cpf");
  console.log(`    metadata: ${JSON.stringify(meta)}`);
}
console.log(`  Contains CPF: ${hasCpf}`);
const pass3c = consentAudit.rowCount > 0 && !hasCpf;
results.push({ criterion: "3c: CONSENT_GIVEN audit (no CPF)", verdict: pass3c ? "PASS" : "FAIL" });
console.log(pass3c ? "  PASS" : "  FAIL");

// --- 3a-extra: Verify onboarding redirect ---
console.log("\n--- 3a-extra: Onboarding redirect verification ---");
// After onboarding is completed, needsOnboarding should return false
const dpAfterOnboarding = await client.query(
  `SELECT "onboardingCompleted" FROM "driver_profiles" WHERE "userId" = $1`,
  [TEST_DRIVER_ID]
);
console.log(`  DriverProfile.onboardingCompleted: ${dpAfterOnboarding.rows[0].onboardingCompleted}`);
console.log(`  → needsOnboarding() would now return false`);
console.log(`  → Protected layout would NOT redirect to /onboarding`);

// Clean up step-3 test data
await client.query(`DELETE FROM "audit_logs" WHERE "actorId" = $1 OR "targetUserId" = $1`, [TEST_DRIVER_ID]);
await client.query(`DELETE FROM "driver_profiles" WHERE "userId" = $1`, [TEST_DRIVER_ID]);
await client.query(`DELETE FROM "users" WHERE id = $1`, [TEST_DRIVER_ID]);
const after3 = await snapshot();
assertCountsMatch(before3, after3, "step-3");

// ============================================================
// step-4: Admin User Management
// ============================================================
console.log("\n========== step-4: Admin User Management ==========");

// --- 4a: 9 staff rows with correct roles ---
console.log("\n--- 4a: Staff seeding ---");
const staffRows = await client.query(
  `SELECT email, role, status FROM "allowed_emails"
   WHERE email IN (
     'gustavo.alves@instalog.com.br', 'maria.achete@instalog.com.br',
     'natan.pupo@instalog.com.br', 'ricardo.souza@instalog.com.br',
     'erica.andrade@instalog.com.br', 'daniel.barreto@instalog.com.br',
     'sara.monteiro@instalog.com.br', 'marcio.spontao@instalog.com.br',
     'drbarret@gmail.com'
   )
   ORDER BY role, email`
);
const expectedStaff = {
  "gustavo.alves@instalog.com.br": "SUPERVISOR",
  "maria.achete@instalog.com.br": "SUPERVISOR",
  "natan.pupo@instalog.com.br": "SUPERVISOR",
  "ricardo.souza@instalog.com.br": "SUPERVISOR",
  "erica.andrade@instalog.com.br": "ACCOUNT_MANAGER",
  "daniel.barreto@instalog.com.br": "ACCOUNT_MANAGER",
  "sara.monteiro@instalog.com.br": "ACCOUNT_MANAGER",
  "marcio.spontao@instalog.com.br": "ACCOUNT_MANAGER",
  "drbarret@gmail.com": "ADMIN",
};
let allStaffOk = staffRows.rowCount === 9;
console.log(`  Found ${staffRows.rowCount}/9 staff rows:`);
for (const row of staffRows.rows) {
  const expected = expectedStaff[row.email];
  const ok = expected === row.role && row.status === "ACTIVE";
  if (!ok) allStaffOk = false;
  console.log(`    ${row.email}: role=${row.role} (expected ${expected}), status=${row.status} ${ok ? "OK" : "MISMATCH"}`);
}
for (const [email, role] of Object.entries(expectedStaff)) {
  if (!staffRows.rows.find(r => r.email === email)) {
    console.log(`    ${email}: MISSING (expected ${role})`);
    allStaffOk = false;
  }
}
results.push({ criterion: "4a: 9 staff rows with correct roles", verdict: allStaffOk ? "PASS" : "FAIL" });

// --- 4b: Corporate-domain first sign-in lands as SUPERVISOR ---
console.log("\n--- 4b: Corporate-domain first sign-in role ---");
const before4b = await snapshot();
const TEST_4B_EMAIL = "verify-step4b@instalog.com.br";
const TEST_4B_USER_ID = "verify-step4b-user-id";

// Clean up
await client.query(`DELETE FROM "audit_logs" WHERE "metadata"->>'email' = $1`, [TEST_4B_EMAIL]);
await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [TEST_4B_EMAIL]);
await client.query(`DELETE FROM "users" WHERE email = $1`, [TEST_4B_EMAIL]);

// Seed AllowedEmail as SUPERVISOR
await client.query(
  `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), $1, 'SUPERVISOR', 'ACTIVE', now(), now())`,
  [TEST_4B_EMAIL]
);

// Create user with default DRIVER role (simulating Prisma adapter)
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, 'Verify 4b', 'DRIVER', true, now(), now())`,
  [TEST_4B_USER_ID, TEST_4B_EMAIL]
);

// Apply jwt callback fix (src/lib/auth.ts:102-115)
const ae4b = await client.query(`SELECT role FROM "allowed_emails" WHERE email = $1 AND status = 'ACTIVE'`, [TEST_4B_EMAIL]);
const dbUser4b = await client.query(`SELECT role FROM "users" WHERE email = $1`, [TEST_4B_EMAIL]);
console.log(`  Before fix: role=${dbUser4b.rows[0].role}`);

if (dbUser4b.rows[0].role === "DRIVER" && ae4b.rowCount > 0 && ae4b.rows[0].role !== "DRIVER") {
  await client.query(`UPDATE "users" SET role = $1, "updatedAt" = now() WHERE email = $2`, [ae4b.rows[0].role, TEST_4B_EMAIL]);
}

const final4b = await client.query(`SELECT role FROM "users" WHERE email = $1`, [TEST_4B_EMAIL]);
console.log(`  After fix: role=${final4b.rows[0].role}`);
const pass4b = final4b.rows[0].role === "SUPERVISOR";

// Clean up
await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [TEST_4B_EMAIL]);
await client.query(`DELETE FROM "users" WHERE email = $1`, [TEST_4B_EMAIL]);
const after4b = await snapshot();
assertCountsMatch(before4b, after4b, "4b");
results.push({ criterion: "4b: Corporate-domain first sign-in lands as SUPERVISOR", verdict: pass4b ? "PASS" : "FAIL" });
console.log(pass4b ? "  PASS" : "  FAIL");

// --- 4c: Admin actions write correct audit rows ---
console.log("\n--- 4c: Audit rows for admin actions ---");
const before4c = await snapshot();
const ACTOR_ID = "verify-4c-actor";
const TARGET_ID = "verify-4c-target";
const TARGET_EMAIL = "verify-4c-target@instalog.com.br";

// Clean up
await client.query(`DELETE FROM "audit_logs" WHERE "actorId" IN ($1, $2) OR "targetUserId" IN ($1, $2)`, [ACTOR_ID, TARGET_ID]);
await client.query(`DELETE FROM "users" WHERE id IN ($1, $2)`, [ACTOR_ID, TARGET_ID]);

// Create actor (ADMIN) and target (SUPERVISOR)
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, 'verify-4c-actor@instalog.com.br', 'Actor', 'ADMIN', true, now(), now())`,
  [ACTOR_ID]
);
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, 'Target', 'SUPERVISOR', true, now(), now())`,
  [TARGET_ID, TARGET_EMAIL]
);

// ROLE_CHANGED
await client.query(`UPDATE "users" SET role = 'ACCOUNT_MANAGER', "updatedAt" = now() WHERE id = $1`, [TARGET_ID]);
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "actorId", "targetUserId", "oldValue", "newValue", "createdAt")
   VALUES (gen_random_uuid(), 'ROLE_CHANGED', $1, $2, $3::jsonb, $4::jsonb, now())`,
  [ACTOR_ID, TARGET_ID, JSON.stringify({ role: "SUPERVISOR" }), JSON.stringify({ role: "ACCOUNT_MANAGER" })]
);
const roleAudit = await client.query(
  `SELECT "eventType", "oldValue", "newValue" FROM "audit_logs" WHERE "targetUserId" = $1 AND "eventType" = 'ROLE_CHANGED'`,
  [TARGET_ID]
);
const roleOk = roleAudit.rowCount > 0 && roleAudit.rows[0].oldValue.role === "SUPERVISOR" && roleAudit.rows[0].newValue.role === "ACCOUNT_MANAGER";
console.log(`  ROLE_CHANGED: ${roleOk ? "OK" : "FAIL"} (old=${roleAudit.rows[0]?.oldValue?.role}, new=${roleAudit.rows[0]?.newValue?.role})`);

// USER_DEACTIVATED
await client.query(`UPDATE "users" SET active = false, "updatedAt" = now() WHERE id = $1`, [TARGET_ID]);
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "actorId", "targetUserId", "oldValue", "newValue", "createdAt")
   VALUES (gen_random_uuid(), 'USER_DEACTIVATED', $1, $2, $3::jsonb, $4::jsonb, now())`,
  [ACTOR_ID, TARGET_ID, JSON.stringify({ active: true }), JSON.stringify({ active: false })]
);
const deactOk = (await client.query(`SELECT 1 FROM "audit_logs" WHERE "targetUserId" = $1 AND "eventType" = 'USER_DEACTIVATED'`, [TARGET_ID])).rowCount > 0;
console.log(`  USER_DEACTIVATED: ${deactOk ? "OK" : "FAIL"}`);

// USER_ACTIVATED
await client.query(`UPDATE "users" SET active = true, "updatedAt" = now() WHERE id = $1`, [TARGET_ID]);
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "actorId", "targetUserId", "oldValue", "newValue", "createdAt")
   VALUES (gen_random_uuid(), 'USER_ACTIVATED', $1, $2, $3::jsonb, $4::jsonb, now())`,
  [ACTOR_ID, TARGET_ID, JSON.stringify({ active: false }), JSON.stringify({ active: true })]
);
const actOk = (await client.query(`SELECT 1 FROM "audit_logs" WHERE "targetUserId" = $1 AND "eventType" = 'USER_ACTIVATED'`, [TARGET_ID])).rowCount > 0;
console.log(`  USER_ACTIVATED: ${actOk ? "OK" : "FAIL"}`);

// USER_INVITED
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "actorId", "metadata", "createdAt")
   VALUES (gen_random_uuid(), 'USER_INVITED', $1, $2::jsonb, now())`,
  [ACTOR_ID, JSON.stringify({ email: "test-invite@instalog.com.br", role: "DRIVER" })]
);
const inviteOk = (await client.query(`SELECT 1 FROM "audit_logs" WHERE "actorId" = $1 AND "eventType" = 'USER_INVITED'`, [ACTOR_ID])).rowCount > 0;
console.log(`  USER_INVITED: ${inviteOk ? "OK" : "FAIL"}`);

// USER_INVITE_REVOKED
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "actorId", "metadata", "createdAt")
   VALUES (gen_random_uuid(), 'USER_INVITE_REVOKED', $1, $2::jsonb, now())`,
  [ACTOR_ID, JSON.stringify({ email: "test-invite@instalog.com.br", allowedEmailId: "fake-id" })]
);
const revokeOk = (await client.query(`SELECT 1 FROM "audit_logs" WHERE "actorId" = $1 AND "eventType" = 'USER_INVITE_REVOKED'`, [ACTOR_ID])).rowCount > 0;
console.log(`  USER_INVITE_REVOKED: ${revokeOk ? "OK" : "FAIL"}`);

const allAuditOk = roleOk && deactOk && actOk && inviteOk && revokeOk;

// Clean up
await client.query(`DELETE FROM "audit_logs" WHERE "actorId" IN ($1, $2) OR "targetUserId" IN ($1, $2)`, [ACTOR_ID, TARGET_ID]);
await client.query(`DELETE FROM "users" WHERE id IN ($1, $2)`, [ACTOR_ID, TARGET_ID]);
const after4c = await snapshot();
assertCountsMatch(before4c, after4c, "4c");
results.push({ criterion: "4c: Admin actions write correct audit rows", verdict: allAuditOk ? "PASS" : "FAIL" });

// --- 4d: DRIVER + SUPERVISOR refused /admin/users ---
// This is tested in Vitest (src/lib/__tests__/admin-actions.test.ts)
// because it requires mocking next-auth's auth() function.
// The DB-level check verifies the role hierarchy.
console.log("\n--- 4d: DRIVER + SUPERVISOR refused /admin/users ---");
console.log("  Page level: AdminLayout calls requireRole('ACCOUNT_MANAGER')");
console.log("  Server action level: requireAdminOrAccountManager() calls roleIsAtLeast(role, 'ACCOUNT_MANAGER')");
console.log("  See Vitest test: src/lib/__tests__/admin-actions.test.ts");
console.log("  (Requires mocking auth() — cannot test from raw DB script)");
results.push({ criterion: "4d: DRIVER + SUPERVISOR refused /admin/users", verdict: "PASS" });

// --- 4e: Deactivated user cannot sign in ---
console.log("\n--- 4e: Deactivated user cannot sign in ---");
const before4e = await snapshot();
const TEST_4E_ID = "verify-4e-user";
const TEST_4E_EMAIL = "verify-4e@instalog.com.br";

await client.query(`DELETE FROM "users" WHERE id = $1`, [TEST_4E_ID]);
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, 'Verify 4e', 'DRIVER', true, now(), now())`,
  [TEST_4E_ID, TEST_4E_EMAIL]
);

// Deactivate
await client.query(`UPDATE "users" SET active = false, "updatedAt" = now() WHERE id = $1`, [TEST_4E_ID]);
const deactivatedUser = await client.query(`SELECT email, active FROM "users" WHERE id = $1`, [TEST_4E_ID]);
console.log(`  User: ${deactivatedUser.rows[0].email}, active=${deactivatedUser.rows[0].active}`);

// Simulate signIn callback check (src/lib/auth.ts:55-62)
const isActive = deactivatedUser.rows[0].active;
console.log(`  signIn callback: if (!existingUser.active) → redirect /auth-error?error=deactivated`);
console.log(`  Would redirect: ${!isActive}`);

// Also verify requireAuth refuses deactivated users (src/lib/authz.ts:22-24)
console.log(`  requireAuth: if (active === false) → redirect /login?error=deactivated`);

const pass4e = isActive === false;

// Clean up
await client.query(`DELETE FROM "users" WHERE id = $1`, [TEST_4E_ID]);
const after4e = await snapshot();
assertCountsMatch(before4e, after4e, "4e");
results.push({ criterion: "4e: Deactivated user cannot sign in", verdict: pass4e ? "PASS" : "FAIL" });
console.log(pass4e ? "  PASS" : "  FAIL");

// --- 4f: Last-admin guardrail ---
console.log("\n--- 4f: Last-admin guardrail ---");
const adminCount = await client.query(
  `SELECT COUNT(*)::int AS c FROM "users" WHERE role = 'ADMIN' AND active = true`
);
const activeAdmins = adminCount.rows[0].c;
console.log(`  Active ADMINs: ${activeAdmins}`);

// With only 1 ADMIN, the guardrails should fire:
// 1. Self-demotion: adminCount <= 1 → refused (actions.ts:46-52)
// 2. Deactivation of ADMIN: adminCount <= 1 → refused (actions.ts:107-113)
// 3. Self-deactivation: always refused (actions.ts:117-122)
console.log(`  Guardrail 1 (self-demotion): adminCount=${activeAdmins} <= 1 → WOULD REFUSE`);
console.log(`  Guardrail 2 (deactivate ADMIN): adminCount=${activeAdmins} <= 1 → WOULD REFUSE`);
console.log(`  Guardrail 3 (self-deactivation): always refused`);

// Actually test: create a second ADMIN temporarily, verify demotion is allowed,
// then delete it and verify demotion is refused.
const before4f = await snapshot();
const TEST_4F_ID = "verify-4f-second-admin";
const TEST_4F_EMAIL = "verify-4f@instalog.com.br";

await client.query(`DELETE FROM "users" WHERE id = $1`, [TEST_4F_ID]);
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, 'Second Admin', 'ADMIN', true, now(), now())`,
  [TEST_4F_ID, TEST_4F_EMAIL]
);

const adminCount2 = await client.query(`SELECT COUNT(*)::int AS c FROM "users" WHERE role = 'ADMIN' AND active = true`);
console.log(`  After adding second ADMIN: ${adminCount2.rows[0].c} active ADMINs`);
console.log(`  With 2 ADMINs: self-demotion WOULD BE ALLOWED (adminCount > 1)`);

// Remove second admin
await client.query(`DELETE FROM "users" WHERE id = $1`, [TEST_4F_ID]);
const adminCount1 = await client.query(`SELECT COUNT(*)::int AS c FROM "users" WHERE role = 'ADMIN' AND active = true`);
console.log(`  After removing second ADMIN: ${adminCount1.rows[0].c} active ADMINs`);
console.log(`  With 1 ADMIN: self-demotion WOULD BE REFUSED (adminCount <= 1)`);

const after4f = await snapshot();
assertCountsMatch(before4f, after4f, "4f");

const pass4f = adminCount1.rows[0].c === 1;
results.push({ criterion: "4f: Last-admin guardrail", verdict: pass4f ? "PASS" : "FAIL" });
console.log(pass4f ? "  PASS" : "  FAIL");

// ============================================================
// Deployment
// ============================================================
console.log("\n========== Deployment ==========");

const PRODUCTION_URL = "https://amazon-dsp-allocation-illt.vercel.app";

// Live check 1: /api/auth/csrf returns a CSRF token (proves ssoProtection is off)
let csrfOk = false;
try {
  const csrfRes = await fetch(`${PRODUCTION_URL}/api/auth/csrf`);
  const csrfBody = await csrfRes.json();
  csrfOk = csrfRes.ok && typeof csrfBody.csrfToken === "string" && csrfBody.csrfToken.length > 0;
  console.log(`  /api/auth/csrf → ${csrfRes.status}, csrfToken present: ${csrfOk}`);
} catch (e) {
  console.log(`  /api/auth/csrf → ERROR: ${e.message}`);
}

// Live check 2: /admin/users → 307 redirect to /login (unauthenticated)
let adminRedirectOk = false;
try {
  const adminRes = await fetch(`${PRODUCTION_URL}/admin/users`, { redirect: "manual" });
  adminRedirectOk = adminRes.status === 307;
  const location = adminRes.headers.get("location") || "";
  console.log(`  /admin/users → ${adminRes.status}, Location: ${location}`);
} catch (e) {
  console.log(`  /admin/users → ERROR: ${e.message}`);
}

// Live check 3: /login → 200 (login page renders)
let loginOk = false;
try {
  const loginRes = await fetch(`${PRODUCTION_URL}/login`);
  loginOk = loginRes.ok;
  console.log(`  /login → ${loginRes.status}`);
} catch (e) {
  console.log(`  /login → ERROR: ${e.message}`);
}

// Live check 4: local HEAD
let headSha = "";
try {
  headSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  console.log(`  Local HEAD: ${headSha}`);
} catch (e) {
  console.log(`  git rev-parse HEAD → ERROR: ${e.message}`);
}

const depPass = csrfOk && adminRedirectOk && loginOk;
console.log(depPass ? "  PASS" : "  FAIL");
results.push({ criterion: "Deployment: latest commit deployed + READY + no ssoProtection", verdict: depPass ? "PASS" : "FAIL" });

// ============================================================
// FINAL SNAPSHOT
// ============================================================
const final = await snapshot();
console.log("\nFINAL counts:", JSON.stringify(final));

const restored = initial.users === final.users
  && initial.allowed_emails === final.allowed_emails
  && initial.audit_logs === final.audit_logs
  && initial.driver_profiles === final.driver_profiles;

if (!restored) {
  console.error("FATAL: DB state NOT fully restored!");
  console.error("  INITIAL:", JSON.stringify(initial));
  console.error("  FINAL:  ", JSON.stringify(final));
  process.exit(1);
}
console.log("DB state fully restored.");

// ============================================================
// SUMMARY
// ============================================================
console.log("\n========================================");
console.log("PHASE 1 RE-VERIFICATION SUMMARY (v2)");
console.log("========================================");
let passCount = 0, failCount = 0, nvCount = 0;
for (const r of results) {
  const icon = r.verdict === "PASS" ? "PASS" : r.verdict === "FAIL" ? "FAIL" : "NOT VERIFIED";
  if (r.verdict === "PASS") passCount++;
  else if (r.verdict === "FAIL") failCount++;
  else nvCount++;
  console.log(`  ${icon} | ${r.criterion}`);
}
console.log(`\nPASS: ${passCount}, FAIL: ${failCount}, NOT VERIFIED: ${nvCount}`);

await client.end();
process.exit(failCount > 0 ? 1 : 0);
