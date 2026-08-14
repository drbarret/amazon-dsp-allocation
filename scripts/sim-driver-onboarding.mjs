#!/usr/bin/env node
// Simulation: create a disposable driver with LARGE_VAN + 3 cities,
// read back, delete everything, and prove counts are restored.
import pg from "pg";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch { /* ok */ }

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  // 1. Snapshot counts before
  const before = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM driver_profiles) AS driver_profiles,
      (SELECT COUNT(*) FROM region_city_preferences) AS city_prefs,
      (SELECT COUNT(*) FROM allowed_emails) AS allowed_emails
  `);
  console.log("BEFORE:", before.rows[0]);

  // 2. Create disposable user + driver profile
  const userId = randomUUID();
  const email = `sim-test-${Date.now()}@example.com`;
  const profileId = randomUUID();

  await client.query(`INSERT INTO users (id, email, name, role, "updatedAt") VALUES ($1, $2, 'Sim Test', 'DRIVER', NOW())`, [userId, email]);
  await client.query(`INSERT INTO driver_profiles (id, "userId", "vehicleType", "onboardingCompleted", "updatedAt") VALUES ($1, $2, 'LARGE_VAN', true, NOW())`, [profileId, userId]);

  // 3. Insert 3 city preferences with priority order
  const cities = [
    { city: "Jundiaí", priority: 1 },
    { city: "Louveira", priority: 2 },
    { city: "Vinhedo", priority: 3 },
  ];
  for (const c of cities) {
    await client.query(
      `INSERT INTO region_city_preferences (id, "driverProfileId", city, priority) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), profileId, c.city, c.priority]
    );
  }

  // 4. Read back
  const driver = await client.query(`SELECT "vehicleType" FROM driver_profiles WHERE id = $1`, [profileId]);
  console.log("Vehicle type:", driver.rows[0].vehicleType);
  console.assert(driver.rows[0].vehicleType === "LARGE_VAN", "Expected LARGE_VAN");

  const prefs = await client.query(
    `SELECT city, priority FROM region_city_preferences WHERE "driverProfileId" = $1 ORDER BY priority`,
    [profileId]
  );
  console.log("City preferences:", prefs.rows);
  console.assert(prefs.rows.length === 3, "Expected 3 city preferences");
  console.assert(prefs.rows[0].city === "Jundiaí", "Expected Jundiaí first");
  console.assert(prefs.rows[1].city === "Louveira", "Expected Louveira second");
  console.assert(prefs.rows[2].city === "Vinhedo", "Expected Vinhedo third");

  // 5. Delete everything
  await client.query(`DELETE FROM region_city_preferences WHERE "driverProfileId" = $1`, [profileId]);
  await client.query(`DELETE FROM driver_profiles WHERE id = $1`, [profileId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

  // 6. Snapshot counts after
  const after = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM driver_profiles) AS driver_profiles,
      (SELECT COUNT(*) FROM region_city_preferences) AS city_prefs,
      (SELECT COUNT(*) FROM allowed_emails) AS allowed_emails
  `);
  console.log("AFTER:", after.rows[0]);

  // 7. Verify counts restored
  console.assert(before.rows[0].users === after.rows[0].users, "User count restored");
  console.assert(before.rows[0].driver_profiles === after.rows[0].driver_profiles, "Driver profile count restored");
  console.assert(before.rows[0].city_prefs === after.rows[0].city_prefs, "City prefs count restored");
  console.assert(before.rows[0].allowed_emails === after.rows[0].allowed_emails, "Allowed emails count restored");

  console.log("\n✅ All assertions passed. Counts restored.");
} catch (err) {
  console.error("❌ Simulation failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
