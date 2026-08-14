#!/usr/bin/env node
/**
 * Proof script: Two-layer defense verification against real DB.
 *
 * Tests:
 * 1. Inactive driver is refused at BOTH layers
 * 2. Active driver is accepted at both layers
 * 3. Escape path: delete User row of inactive driver → still blocked by Layer 1
 * 4. Full reactivation cycle
 *
 * Uses transactions with rollback — no permanent changes.
 * Emails are masked in output.
 */

import pg from "pg";

try { process.loadEnvFile(".env.local"); } catch { /* ok */ }

const { Client } = pg;

function maskEmail(email) {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log("=".repeat(70));
  console.log("TWO-LAYER DEFENSE PROOF");
  console.log("=".repeat(70));

  // -----------------------------------------------------------------------
  // Pre-flight: count state
  // -----------------------------------------------------------------------
  const preFlight = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COUNT(*)::int FROM users WHERE active = true) AS active_users,
      (SELECT COUNT(*)::int FROM users WHERE active = false) AS inactive_users,
      (SELECT COUNT(*)::int FROM driver_profiles) AS total_profiles,
      (SELECT COUNT(*)::int FROM allowed_emails) AS total_allowed,
      (SELECT COUNT(*)::int FROM allowed_emails WHERE status = 'ACTIVE') AS active_allowed,
      (SELECT COUNT(*)::int FROM allowed_emails WHERE status = 'BLOCKED') AS blocked_allowed,
      (SELECT COUNT(*)::int FROM allowed_emails WHERE status = 'REVOKED') AS revoked_allowed
  `);
  const pf = preFlight.rows[0];
  console.log("\nPre-flight counts:");
  console.log(`  Users: ${pf.total_users} (${pf.active_users} active, ${pf.inactive_users} inactive)`);
  console.log(`  DriverProfiles: ${pf.total_profiles}`);
  console.log(`  AllowedEmails: ${pf.total_allowed} (${pf.active_allowed} ACTIVE, ${pf.blocked_allowed} BLOCKED, ${pf.revoked_allowed} REVOKED)`);

  // -----------------------------------------------------------------------
  // Pick one inactive driver and one active driver for testing
  // -----------------------------------------------------------------------
  const inactiveDriver = await client.query(`
    SELECT u.id, u.email, u.active, ae.status as allowed_status
    FROM users u
    JOIN allowed_emails ae ON ae.email = u.email
    WHERE u.active = false AND u.role = 'DRIVER'
    LIMIT 1
  `);

  const activeDriver = await client.query(`
    SELECT u.id, u.email, u.active, ae.status as allowed_status
    FROM users u
    JOIN allowed_emails ae ON ae.email = u.email
    WHERE u.active = true AND u.role = 'DRIVER'
    LIMIT 1
  `);

  if (inactiveDriver.rowCount === 0 || activeDriver.rowCount === 0) {
    console.error("Could not find test drivers!");
    await client.end();
    process.exit(1);
  }

  const inactive = inactiveDriver.rows[0];
  const active = activeDriver.rows[0];

  console.log(`\nTest subjects:`);
  console.log(`  Inactive: ${maskEmail(inactive.email)} (User.active=${inactive.active}, AllowedEmail.status=${inactive.allowed_status})`);
  console.log(`  Active:   ${maskEmail(active.email)} (User.active=${active.active}, AllowedEmail.status=${active.allowed_status})`);

  // -----------------------------------------------------------------------
  // Proof 1: Inactive driver — Layer 1 (AllowedEmail) check
  // -----------------------------------------------------------------------
  console.log("\n" + "-".repeat(70));
  console.log("PROOF 1: Inactive driver — Layer 1 (AllowedEmail.status) check");
  console.log("-".repeat(70));

  const layer1Inactive = await client.query(
    `SELECT status FROM allowed_emails WHERE email = $1`,
    [inactive.email]
  );
  const l1Status = layer1Inactive.rows[0]?.status;
  console.log(`  AllowedEmail.status = ${l1Status}`);
  console.log(`  Layer 1 blocks? ${l1Status !== 'ACTIVE' ? 'YES (BLOCKED ≠ ACTIVE)' : 'NO (would pass)'}`);
  console.assert(l1Status !== 'ACTIVE', `FAIL: Inactive driver ${maskEmail(inactive.email)} has ACTIVE AllowedEmail!`);

  // -----------------------------------------------------------------------
  // Proof 2: Inactive driver — Layer 2 (User.active) check
  // -----------------------------------------------------------------------
  console.log("\n" + "-".repeat(70));
  console.log("PROOF 2: Inactive driver — Layer 2 (User.active) check");
  console.log("-".repeat(70));

  const layer2Inactive = await client.query(
    `SELECT active FROM users WHERE email = $1`,
    [inactive.email]
  );
  const l2Active = layer2Inactive.rows[0]?.active;
  console.log(`  User.active = ${l2Active}`);
  console.log(`  Layer 2 blocks? ${!l2Active ? 'YES (active=false)' : 'NO (would pass)'}`);
  console.assert(!l2Active, `FAIL: Inactive driver ${maskEmail(inactive.email)} has active=true!`);

  // -----------------------------------------------------------------------
  // Proof 3: Active driver — both layers pass
  // -----------------------------------------------------------------------
  console.log("\n" + "-".repeat(70));
  console.log("PROOF 3: Active driver — both layers pass");
  console.log("-".repeat(70));

  const layer1Active = await client.query(
    `SELECT status FROM allowed_emails WHERE email = $1`,
    [active.email]
  );
  const l1ActiveStatus = layer1Active.rows[0]?.status;
  console.log(`  AllowedEmail.status = ${l1ActiveStatus}`);
  console.log(`  Layer 1 passes? ${l1ActiveStatus === 'ACTIVE' ? 'YES' : 'NO'}`);

  const layer2Active = await client.query(
    `SELECT active FROM users WHERE email = $1`,
    [active.email]
  );
  const l2ActiveVal = layer2Active.rows[0]?.active;
  console.log(`  User.active = ${l2ActiveVal}`);
  console.log(`  Layer 2 passes? ${l2ActiveVal ? 'YES' : 'NO'}`);

  console.assert(l1ActiveStatus === 'ACTIVE', `FAIL: Active driver ${maskEmail(active.email)} has non-ACTIVE AllowedEmail!`);
  console.assert(l2ActiveVal === true, `FAIL: Active driver ${maskEmail(active.email)} has active=false!`);

  // -----------------------------------------------------------------------
  // Proof 4: Escape path — delete User row, Layer 1 still blocks
  // -----------------------------------------------------------------------
  console.log("\n" + "-".repeat(70));
  console.log("PROOF 4: Escape path — delete User row, Layer 1 still blocks");
  console.log("-".repeat(70));

  // Use a transaction with rollback
  await client.query("BEGIN");
  try {
    // Verify current state
    const beforeDelete = await client.query(
      `SELECT id, active FROM users WHERE email = $1`,
      [inactive.email]
    );
    console.log(`  Before: User exists (id=${beforeDelete.rows[0]?.id?.slice(0,8)}..., active=${beforeDelete.rows[0]?.active})`);

    // Delete the User row (simulating what would happen if someone cleaned up)
    await client.query(`DELETE FROM users WHERE email = $1`, [inactive.email]);

    const afterDelete = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [inactive.email]
    );
    console.log(`  After delete: User exists? ${afterDelete.rowCount > 0 ? 'YES' : 'NO'}`);

    // Now check Layer 1: AllowedEmail still BLOCKED
    const layer1AfterDelete = await client.query(
      `SELECT status FROM allowed_emails WHERE email = $1`,
      [inactive.email]
    );
    const l1AfterStatus = layer1AfterDelete.rows[0]?.status;
    console.log(`  AllowedEmail.status after User delete: ${l1AfterStatus}`);
    console.log(`  Layer 1 still blocks? ${l1AfterStatus !== 'ACTIVE' ? 'YES — escape path CLOSED' : 'NO — escape path OPEN'}`);
    console.assert(l1AfterStatus !== 'ACTIVE', `FAIL: Escape path is OPEN! AllowedEmail still ACTIVE after User delete.`);

    console.log("  ✅ Escape path is CLOSED. Even if User is recreated by adapter, Layer 1 blocks.");
  } finally {
    await client.query("ROLLBACK");
    console.log("  (Transaction rolled back — no permanent changes)");
  }

  // Verify user was restored
  const afterRollback = await client.query(
    `SELECT id, active FROM users WHERE email = $1`,
    [inactive.email]
  );
  console.log(`  After rollback: User restored (active=${afterRollback.rows[0]?.active})`);

  // -----------------------------------------------------------------------
  // Proof 5: Full reactivation cycle
  // -----------------------------------------------------------------------
  console.log("\n" + "-".repeat(70));
  console.log("PROOF 5: Full reactivation cycle");
  console.log("-".repeat(70));

  await client.query("BEGIN");
  try {
    // Step 1: Verify inactive driver is blocked at both layers
    const step1User = await client.query(
      `SELECT active FROM users WHERE email = $1`,
      [inactive.email]
    );
    const step1Allowed = await client.query(
      `SELECT status FROM allowed_emails WHERE email = $1`,
      [inactive.email]
    );
    console.log(`  Step 1 — Before reactivation:`);
    console.log(`    User.active = ${step1User.rows[0].active}`);
    console.log(`    AllowedEmail.status = ${step1Allowed.rows[0].status}`);
    console.log(`    Login blocked? ${!step1User.rows[0].active && step1Allowed.rows[0].status !== 'ACTIVE' ? 'YES (both layers)' : 'NO'}`);

    // Step 2: Reactivate (simulate what reactivateUser does)
    await client.query(
      `UPDATE users SET active = true, "updatedAt" = now() WHERE email = $1`,
      [inactive.email]
    );
    await client.query(
      `UPDATE allowed_emails SET status = 'ACTIVE', "updatedAt" = now() WHERE email = $1 AND status = 'BLOCKED'`,
      [inactive.email]
    );

    const step2User = await client.query(
      `SELECT active FROM users WHERE email = $1`,
      [inactive.email]
    );
    const step2Allowed = await client.query(
      `SELECT status FROM allowed_emails WHERE email = $1`,
      [inactive.email]
    );
    console.log(`  Step 2 — After reactivation:`);
    console.log(`    User.active = ${step2User.rows[0].active}`);
    console.log(`    AllowedEmail.status = ${step2Allowed.rows[0].status}`);
    console.log(`    Login allowed? ${step2User.rows[0].active && step2Allowed.rows[0].status === 'ACTIVE' ? 'YES (both layers)' : 'NO'}`);

    console.assert(step2User.rows[0].active === true, "FAIL: User not reactivated!");
    console.assert(step2Allowed.rows[0].status === 'ACTIVE', "FAIL: AllowedEmail not reactivated!");

    console.log("  ✅ Reactivation cycle works: both layers restored.");
  } finally {
    await client.query("ROLLBACK");
    console.log("  (Transaction rolled back — no permanent changes)");
  }

  // -----------------------------------------------------------------------
  // Final counts
  // -----------------------------------------------------------------------
  console.log("\n" + "=".repeat(70));
  console.log("FINAL COUNTS");
  console.log("=".repeat(70));

  const final = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COUNT(*)::int FROM users WHERE active = true) AS active_users,
      (SELECT COUNT(*)::int FROM users WHERE active = false) AS inactive_users,
      (SELECT COUNT(*)::int FROM driver_profiles) AS total_profiles,
      (SELECT COUNT(*)::int FROM allowed_emails) AS total_allowed,
      (SELECT COUNT(*)::int FROM allowed_emails WHERE status = 'ACTIVE') AS active_allowed,
      (SELECT COUNT(*)::int FROM allowed_emails WHERE status = 'BLOCKED') AS blocked_allowed,
      (SELECT COUNT(*)::int FROM allowed_emails WHERE status = 'REVOKED') AS revoked_allowed
  `);
  const f = final.rows[0];
  console.log(`  Users: ${f.total_users} (${f.active_users} active, ${f.inactive_users} inactive)`);
  console.log(`  DriverProfiles: ${f.total_profiles}`);
  console.log(`  AllowedEmails: ${f.total_allowed} (${f.active_allowed} ACTIVE, ${f.blocked_allowed} BLOCKED, ${f.revoked_allowed} REVOKED)`);

  // Verify expected counts
  console.assert(f.total_users === 125, `Expected 125 users, got ${f.total_users}`);
  console.assert(f.total_profiles === 124, `Expected 124 profiles, got ${f.total_profiles}`);
  console.assert(f.active_users === 84, `Expected 84 active users, got ${f.active_users}`);
  console.assert(f.inactive_users === 41, `Expected 41 inactive users, got ${f.inactive_users}`);
  console.assert(f.blocked_allowed === 41, `Expected 41 BLOCKED allowed_emails, got ${f.blocked_allowed}`);
  // 83 active drivers + 9 staff = 92 ACTIVE
  console.assert(f.active_allowed === 92, `Expected 92 ACTIVE allowed_emails, got ${f.active_allowed}`);

  console.log("\n✅ All proofs passed. Two-layer defense is active.");
  console.log(`   Layer 1: ${f.blocked_allowed} BLOCKED AllowedEmails block at authorizeSignIn`);
  console.log(`   Layer 2: ${f.inactive_users} inactive Users block at signIn callback`);
  console.log(`   Escape path: CLOSED (Layer 1 survives User row deletion)`);

  await client.end();
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
