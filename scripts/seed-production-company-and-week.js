const { Client } = require("pg");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const COMPANY_NAME = "ILLT = Instalog";
const ADMIN_ID = "78b18e88-7b07-438a-a5a9-a035ff02d52e";

async function main() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query("BEGIN");

    // 1. Create transport company
    const companyResult = await client.query(
      `INSERT INTO "transport_companies" ("id", "name", "active", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, true, now(), now())
       RETURNING id, name`,
      [COMPANY_NAME]
    );
    const companyId = companyResult.rows[0].id;
    console.log("Created company:", companyResult.rows[0]);

    // 2. Link active drivers
    const updateResult = await client.query(
      `UPDATE "users"
       SET "transportCompanyId" = $1, "updatedAt" = now()
       WHERE role = 'DRIVER' AND active = true AND "transportCompanyId" IS NULL
       RETURNING id`,
      [companyId]
    );
    const linkedCount = updateResult.rowCount;
    console.log("Linked active drivers:", linkedCount);

    // 3. Create DispatchWeek W35
    const weekResult = await client.query(
      `INSERT INTO "dispatch_weeks"
        ("id", "transportCompanyId", "weekKey", "year", "weekNumber", "startDate", "endDate", "status", "createdById", "createdAt", "updatedAt")
       VALUES
        (gen_random_uuid(), $1, 'WK-35', 2026, 35, '2026-08-23', '2026-08-29', 'PLANNING', $2, now(), now())
       RETURNING id, "weekKey", "transportCompanyId", "startDate", "endDate"`,
      [companyId, ADMIN_ID]
    );
    console.log("Created week:", weekResult.rows[0]);

    await client.query("COMMIT");

    // 4. Validation
    const validation = await client.query(
      `SELECT dw.id, dw."weekKey", dw."weekNumber", dw."startDate", dw."endDate", dw.status, tc.name as "companyName"
       FROM "dispatch_weeks" dw
       JOIN "transport_companies" tc ON tc.id = dw."transportCompanyId"
       WHERE dw."weekKey" = 'WK-35'`
    );
    console.log("Validation:", validation.rows);

    const activeDrivers = await client.query(
      `SELECT COUNT(*) as count FROM "users" WHERE "transportCompanyId" = $1 AND role = 'DRIVER' AND active = true`,
      [companyId]
    );
    console.log("Active drivers linked to company:", activeDrivers.rows[0].count);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Transaction failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
