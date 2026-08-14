// DEVELOPMENT-ONLY utility: remove temporary screenshot data from a local/verification database.
import pg from 'pg';
process.loadEnvFile('.env.local');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
(async () => {
  await client.connect();
  await client.query(`DELETE FROM "vehicle_restrictions" WHERE "driverProfileId" IN (SELECT id FROM "driver_profiles" WHERE "userId" LIKE 'screenshot-%')`);
  await client.query(`DELETE FROM "driver_profiles" WHERE "userId" LIKE 'screenshot-%'`);
  await client.query(`DELETE FROM "audit_logs" WHERE "actorId" LIKE 'screenshot-%' OR "targetUserId" LIKE 'screenshot-%'`);
  await client.query(`DELETE FROM "allowed_emails" WHERE email LIKE 'screenshot-%' OR email LIKE 'driver%.temp@%'`);
  await client.query(`DELETE FROM "users" WHERE id LIKE 'screenshot-%' OR email LIKE 'screenshot-%' OR email LIKE 'driver%.temp@%'`);
  const r = await client.query(`SELECT COUNT(*)::int AS c FROM "users"`);
  console.log('Users:', r.rows[0].c);
  const ae = await client.query(`SELECT COUNT(*)::int AS c FROM "allowed_emails"`);
  console.log('Allowed emails:', ae.rows[0].c);
  const dp = await client.query(`SELECT COUNT(*)::int AS c FROM "driver_profiles"`);
  console.log('Driver profiles:', dp.rows[0].c);
  await client.end();
})();
