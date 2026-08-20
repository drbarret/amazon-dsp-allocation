const { Client } = require("pg");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE "transport_companies"
       SET name = 'ILLT', "updatedAt" = now()
       WHERE name = 'ILLT = Instalog' OR name = 'ILLT'
       RETURNING id, name`,
    );

    if (result.rowCount === 0) {
      console.log("No company found with name 'ILLT = Instalog' or 'ILLT'");
      await client.query("ROLLBACK");
      process.exit(0);
    }

    console.log("Updated company:", result.rows[0]);

    await client.query("COMMIT");

    const verify = await client.query(
      `SELECT id, name FROM "transport_companies" WHERE id = $1`,
      [result.rows[0].id]
    );
    console.log("Verification:", verify.rows[0]);

    const linkedCount = await client.query(
      `SELECT COUNT(*) as count FROM "users" WHERE "transportCompanyId" = $1 AND role = 'DRIVER' AND active = true`,
      [result.rows[0].id]
    );
    console.log("Active drivers still linked:", linkedCount.rows[0].count);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
