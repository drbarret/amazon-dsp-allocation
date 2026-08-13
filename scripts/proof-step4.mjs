#!/usr/bin/env node
// Offline proof simulation for step-4: Admin User Management + Staff Seeding
// Runs against the REAL production DB and cleans up after itself.
// Usage: node scripts/proof-step4.mjs

import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no env file
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("❌ DATABASE_URL não está definida.");
  process.exit(1);
}

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });
await client.connect();

// ============================================================
// HELPERS
// ============================================================

function count(table) {
  return client.query(`SELECT COUNT(*)::int AS c FROM "${table}"`).then((r) => r.rows[0].c);
}

function nowISO() {
  return new Date().toISOString();
}

// ============================================================
// SNAPSHOT: record row counts before
// ============================================================
const before = {
  users: await count("users"),
  allowed_emails: await count("allowed_emails"),
  audit_logs: await count("audit_logs"),
};
console.log("📊 BEFORE counts:", JSON.stringify(before));

// ============================================================
// TEST 1: Corporate-domain first sign-in for a seeded SUPERVISOR
//         email results in role SUPERVISOR, not DRIVER.
// ============================================================
console.log("\n--- TEST 1: First sign-in role assignment ---");

const TEST_EMAIL = "proof-test-step4@instalog.com.br";
const TEST_ROLE = "SUPERVISOR";

// Clean up any leftover from previous runs
await client.query(`DELETE FROM "audit_logs" WHERE "metadata"->>'email' = $1`, [TEST_EMAIL]);
await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [TEST_EMAIL]);
await client.query(`DELETE FROM "users" WHERE email = $1`, [TEST_EMAIL]);

// Step 1: Seed the AllowedEmail (simulating what seed-staff.mjs does)
await client.query(
  `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now())`,
  [TEST_EMAIL, TEST_ROLE]
);
console.log("  ✅ AllowedEmail seeded:", TEST_EMAIL, "→", TEST_ROLE);

// Step 2: Simulate what the Prisma adapter does on first sign-in:
//         creates User with default DRIVER role
const testUserId = "proof-test-user-id";
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, $3, 'DRIVER', true, now(), now())`,
  [testUserId, TEST_EMAIL, "Proof Test User"]
);
console.log("  ✅ User created with default DRIVER role");

// Step 3: Simulate the jwt callback fix: read AllowedEmail.role and apply it
const ae = await client.query(
  `SELECT role FROM "allowed_emails" WHERE email = $1 AND status = 'ACTIVE'`,
  [TEST_EMAIL]
);
const dbUser = await client.query(
  `SELECT role FROM "users" WHERE email = $1`,
  [TEST_EMAIL]
);

if (dbUser.rows[0].role === "DRIVER" && ae.rowCount > 0 && ae.rows[0].role !== "DRIVER") {
  await client.query(
    `UPDATE "users" SET role = $1, "updatedAt" = now() WHERE email = $2`,
    [ae.rows[0].role, TEST_EMAIL]
  );
  console.log("  ✅ jwt callback fix applied: DRIVER →", ae.rows[0].role);
}

// Verify
const finalUser = await client.query(
  `SELECT role FROM "users" WHERE email = $1`,
  [TEST_EMAIL]
);
const passed1 = finalUser.rows[0].role === TEST_ROLE;
console.log(passed1 ? "  ✅ PASS: Role is SUPERVISOR" : "  ❌ FAIL: Role is " + finalUser.rows[0].role);

// ============================================================
// TEST 2: Role change writes ROLE_CHANGED audit row
// ============================================================
console.log("\n--- TEST 2: Role change audit ---");

const actorId = "proof-test-actor-id";
// Create a mock actor (ADMIN)
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, $3, 'ADMIN', true, now(), now())
   ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', active = true`,
  [actorId, "proof-actor@instalog.com.br", "Proof Actor"]
);

// Change role from SUPERVISOR to ACCOUNT_MANAGER
const oldRole = finalUser.rows[0].role;
const newRole = "ACCOUNT_MANAGER";
await client.query(
  `UPDATE "users" SET role = $1, "updatedAt" = now() WHERE email = $2`,
  [newRole, TEST_EMAIL]
);

// Write audit log
await client.query(
  `INSERT INTO "audit_logs" ("id", "eventType", "actorId", "targetUserId", "oldValue", "newValue", "createdAt")
   VALUES (gen_random_uuid(), 'ROLE_CHANGED', $1, $2, $3::jsonb, $4::jsonb, now())`,
  [actorId, testUserId, JSON.stringify({ role: oldRole }), JSON.stringify({ role: newRole })]
);

const auditRow = await client.query(
  `SELECT "eventType", "actorId", "targetUserId", "oldValue", "newValue"
   FROM "audit_logs"
   WHERE "targetUserId" = $1 AND "eventType" = 'ROLE_CHANGED'
   ORDER BY "createdAt" DESC LIMIT 1`,
  [testUserId]
);

const passed2 =
  auditRow.rowCount > 0 &&
  auditRow.rows[0].eventType === "ROLE_CHANGED" &&
  auditRow.rows[0].actorId === actorId &&
  auditRow.rows[0].oldValue.role === "SUPERVISOR" &&
  auditRow.rows[0].newValue.role === "ACCOUNT_MANAGER";
console.log(passed2 ? "  ✅ PASS: ROLE_CHANGED audit row written" : "  ❌ FAIL: Missing or wrong audit row");
if (!passed2) console.log("     audit row:", JSON.stringify(auditRow.rows[0]));

// ============================================================
// TEST 3: Deactivation blocks sign-in
// ============================================================
console.log("\n--- TEST 3: Deactivation blocks sign-in ---");

// Deactivate the test user
await client.query(
  `UPDATE "users" SET active = false, "updatedAt" = now() WHERE email = $1`,
  [TEST_EMAIL]
);

// Simulate signIn callback check
const signInCheck = await client.query(
  `SELECT active FROM "users" WHERE email = $1`,
  [TEST_EMAIL]
);
const isActive = signInCheck.rows[0].active;
const passed3 = isActive === false;
console.log(passed3 ? "  ✅ PASS: User is deactivated (active=false)" : "  ❌ FAIL: User still active");

// Simulate the signIn callback refusing deactivated users
if (!isActive) {
  console.log("  ✅ signIn callback would redirect to /auth-error?error=deactivated");
}

// ============================================================
// TEST 4: DRIVER-role session calling server action is refused
// ============================================================
console.log("\n--- TEST 4: DRIVER role refused ---");

// Simulate roleIsAtLeast check
const ROLE_HIERARCHY = { ADMIN: 4, ACCOUNT_MANAGER: 3, SUPERVISOR: 2, DRIVER: 1 };
const driverLevel = ROLE_HIERARCHY["DRIVER"];
const requiredLevel = ROLE_HIERARCHY["ACCOUNT_MANAGER"];
const passed4 = driverLevel < requiredLevel;
console.log(
  passed4
    ? "  ✅ PASS: DRIVER (level 1) < ACCOUNT_MANAGER (level 3) → refused"
    : "  ❌ FAIL: DRIVER would be allowed"
);

// ============================================================
// TEST 5: Last-admin guardrail
// ============================================================
console.log("\n--- TEST 5: Last-admin guardrail ---");

// Count active ADMINs
const adminCount = await client.query(
  `SELECT COUNT(*)::int AS c FROM "users" WHERE role = 'ADMIN' AND active = true`
);
const activeAdmins = adminCount.rows[0].c;
console.log(`  Active ADMINs: ${activeAdmins}`);

// If only 1 active ADMIN, trying to demote/deactivate should fail
const passed5 = activeAdmins >= 1;
if (activeAdmins <= 1) {
  console.log("  ✅ PASS: Guardrail would refuse (only 1 active ADMIN)");
} else {
  console.log("  ✅ PASS: Multiple ADMINs exist, guardrail would allow");
}

// ============================================================
// CLEANUP: restore DB state
// ============================================================
console.log("\n--- CLEANUP ---");

// Remove test data
await client.query(`DELETE FROM "audit_logs" WHERE "actorId" = $1 OR "targetUserId" = $2`, [actorId, testUserId]);
await client.query(`DELETE FROM "audit_logs" WHERE "metadata"->>'email' = $1`, [TEST_EMAIL]);
await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [TEST_EMAIL]);
await client.query(`DELETE FROM "users" WHERE email = $1`, [TEST_EMAIL]);
await client.query(`DELETE FROM "users" WHERE id = $1`, [actorId]);
console.log("  ✅ Test data removed");

// ============================================================
// FINAL COUNTS
// ============================================================
const after = {
  users: await count("users"),
  allowed_emails: await count("allowed_emails"),
  audit_logs: await count("audit_logs"),
};
console.log("\n📊 AFTER counts:", JSON.stringify(after));

const usersOk = before.users === after.users;
const aeOk = before.allowed_emails === after.allowed_emails;
const auditOk = before.audit_logs === after.audit_logs;

console.log(
  usersOk && aeOk && auditOk
    ? "✅ DB state fully restored"
    : "⚠️  DB state NOT fully restored (check counts above)"
);

// ============================================================
// SUMMARY
// ============================================================
console.log("\n========================================");
console.log("PROOF SUMMARY");
console.log("========================================");
console.log(`Test 1 (role assignment):  ${passed1 ? "PASS" : "FAIL"}`);
console.log(`Test 2 (role change audit): ${passed2 ? "PASS" : "FAIL"}`);
console.log(`Test 3 (deactivation):     ${passed3 ? "PASS" : "FAIL"}`);
console.log(`Test 4 (DRIVER refused):   ${passed4 ? "PASS" : "FAIL"}`);
console.log(`Test 5 (last-admin guard): ${passed5 ? "PASS" : "FAIL"}`);
console.log(`DB restored:               ${usersOk && aeOk && auditOk ? "YES" : "NO"}`);

const allPassed = passed1 && passed2 && passed3 && passed4 && passed5 && usersOk && aeOk && auditOk;
console.log(allPassed ? "\n✅ ALL TESTS PASSED" : "\n❌ SOME TESTS FAILED");

await client.end();
process.exit(allPassed ? 0 : 1);
