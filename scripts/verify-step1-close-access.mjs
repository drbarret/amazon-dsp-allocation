#!/usr/bin/env node
// Phase 1.6 step-1: Close the access list — simulation against real DB.
// Exercises authorizeSignIn for: owner, SUPERVISOR, non-listed @instalog.com.br, external.
// Writes ACCESS_DENIED rows, then cleans up and proves row counts restored.
// Usage: node scripts/verify-step1-close-access.mjs

import pg from "pg";
import { randomUUID } from "node:crypto";

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

async function snapshot() {
  return {
    users: await count("users"),
    allowed_emails: await count("allowed_emails"),
    audit_logs: await count("audit_logs"),
    driver_profiles: await count("driver_profiles"),
  };
}

async function assertCountsMatch(before, after, label) {
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

// Simulate authorizeSignIn (closed access list — no corporate domain bypass)
async function authorizeSignIn(email) {
  const normalized = email.toLowerCase().trim();
  const result = await client.query(
    `SELECT email, role, status FROM "allowed_emails" WHERE email = $1`,
    [normalized]
  );
  if (result.rows.length === 0) return { allowed: false, reason: "EMAIL_NOT_AUTHORIZED" };
  const row = result.rows[0];
  if (row.status !== "ACTIVE") return { allowed: false, reason: "EMAIL_NOT_AUTHORIZED" };
  return { allowed: true };
}

// Simulate signIn callback ACCESS_DENIED audit write
async function writeAccessDenied(email, reason) {
  await client.query(
    `INSERT INTO "audit_logs" ("id", "eventType", "metadata", "createdAt") VALUES ($1, $2, $3, NOW())`,
    [randomUUID(), "ACCESS_DENIED", JSON.stringify({ reason, email })]
  );
}

// ============================================================
// MAIN
// ============================================================

console.log("=== Phase 1.6 step-1: Close the access list — DB simulation ===\n");

const initial = await snapshot();
console.log("Initial DB state:", JSON.stringify(initial), "\n");

// ------------------------------------------------------------------
// 1. Verify all 9 pre-registered identities still authorize
// ------------------------------------------------------------------
console.log("--- 1. All 9 pre-registered identities ---");
const identities = [
  { email: "drbarret@gmail.com", role: "ADMIN" },
  { email: "gustavo.alves@instalog.com.br", role: "SUPERVISOR" },
  { email: "maria.achete@instalog.com.br", role: "SUPERVISOR" },
  { email: "natan.pupo@instalog.com.br", role: "SUPERVISOR" },
  { email: "ricardo.souza@instalog.com.br", role: "SUPERVISOR" },
  { email: "erica.andrade@instalog.com.br", role: "ACCOUNT_MANAGER" },
  { email: "daniel.barreto@instalog.com.br", role: "ACCOUNT_MANAGER" },
  { email: "sara.monteiro@instalog.com.br", role: "ACCOUNT_MANAGER" },
  { email: "marcio.spontao@instalog.com.br", role: "ACCOUNT_MANAGER" },
];

let allAuthorized = true;
for (const { email, role } of identities) {
  const result = await authorizeSignIn(email);
  const status = result.allowed ? "ALLOWED" : "REFUSED";
  if (!result.allowed) allAuthorized = false;
  console.log(`  ${email} (${role}): ${status}`);
}
assert(allAuthorized, "Not all 9 pre-registered identities authorized!");
console.log("  => All 9 identities authorize.\n");

// ------------------------------------------------------------------
// 2. Owner specifically
// ------------------------------------------------------------------
console.log("--- 2. Owner (drbarret@gmail.com) ---");
const ownerResult = await authorizeSignIn("drbarret@gmail.com");
console.log(`  authorizeSignIn("drbarret@gmail.com"): ${ownerResult.allowed ? "ALLOWED" : "REFUSED"}`);
assert(ownerResult.allowed, "Owner must be allowed!");
console.log("  => Owner authorizes.\n");

// ------------------------------------------------------------------
// 3. Corporate domain but NOT on the list → refused
// ------------------------------------------------------------------
console.log("--- 3. @instalog.com.br NOT on the list ---");
const notListedResult = await authorizeSignIn("joao.silva@instalog.com.br");
console.log(`  authorizeSignIn("joao.silva@instalog.com.br"): ${notListedResult.allowed ? "ALLOWED" : "REFUSED"}`);
assert(!notListedResult.allowed, "Non-listed @instalog.com.br must be refused!");
console.log("  => Correctly refused.\n");

// ------------------------------------------------------------------
// 4. External address → refused
// ------------------------------------------------------------------
console.log("--- 4. External address ---");
const externalResult = await authorizeSignIn("stranger@gmail.com");
console.log(`  authorizeSignIn("stranger@gmail.com"): ${externalResult.allowed ? "ALLOWED" : "REFUSED"}`);
assert(!externalResult.allowed, "External address must be refused!");
console.log("  => Correctly refused.\n");

// ------------------------------------------------------------------
// 5. Write ACCESS_DENIED rows for the refused attempts
// ------------------------------------------------------------------
console.log("--- 5. ACCESS_DENIED audit rows ---");
const beforeAudit = await count("audit_logs");
console.log(`  audit_logs before: ${beforeAudit}`);

await writeAccessDenied("joao.silva@instalog.com.br", "EMAIL_NOT_AUTHORIZED");
await writeAccessDenied("stranger@gmail.com", "EMAIL_NOT_AUTHORIZED");

const afterAudit = await count("audit_logs");
console.log(`  audit_logs after: ${afterAudit}`);
assert(afterAudit === beforeAudit + 2, "Expected 2 new ACCESS_DENIED rows");

// Verify the rows
const deniedRows = await client.query(
  `SELECT "eventType", "metadata" FROM "audit_logs" WHERE "eventType" = 'ACCESS_DENIED' ORDER BY "createdAt" DESC LIMIT 2`
);
for (const row of deniedRows.rows) {
  console.log(`  ${row.eventType}: ${JSON.stringify(row.metadata)}`);
}
console.log("  => ACCESS_DENIED rows written correctly.\n");

// ------------------------------------------------------------------
// 6. Clean up — delete the ACCESS_DENIED rows we just wrote
// ------------------------------------------------------------------
console.log("--- 6. Cleanup ---");
await client.query(
  `DELETE FROM "audit_logs" WHERE "eventType" = 'ACCESS_DENIED' AND "metadata"->>'email' IN ('joao.silva@instalog.com.br', 'stranger@gmail.com')`
);
const afterCleanup = await count("audit_logs");
console.log(`  audit_logs after cleanup: ${afterCleanup}`);
assert(afterCleanup === beforeAudit, "Audit log count not restored!");

// ------------------------------------------------------------------
// 7. Verify role-promotion path still works (jwt-callback.ts)
//    — check that all 8 staff members have ACTIVE AllowedEmail rows
//    with non-DRIVER roles, so the jwt callback would promote them
// ------------------------------------------------------------------
console.log("\n--- 7. Role-promotion path (jwt-callback.ts) ---");
const staffRows = await client.query(
  `SELECT email, role, status FROM "allowed_emails" WHERE email != 'drbarret@gmail.com' ORDER BY role, email`
);
let allPromotable = true;
for (const row of staffRows.rows) {
  const promotable = row.status === "ACTIVE" && row.role !== "DRIVER";
  if (!promotable) allPromotable = false;
  console.log(`  ${row.email}: role=${row.role} status=${row.status} → ${promotable ? "PROMOTABLE" : "NOT PROMOTABLE"}`);
}
assert(allPromotable, "Not all 8 staff members are promotable!");
console.log("  => All 8 staff members have ACTIVE status with elevated roles.\n");

// ------------------------------------------------------------------
// 8. Final assertion: row counts match initial snapshot
// ------------------------------------------------------------------
const final = await snapshot();
console.log("--- Final DB state ---");
console.log("  Initial:", JSON.stringify(initial));
console.log("  Final:  ", JSON.stringify(final));
assertCountsMatch(initial, final, "step-1 simulation");

console.log("\n=== ALL CHECKS PASSED ===");
await client.end();
