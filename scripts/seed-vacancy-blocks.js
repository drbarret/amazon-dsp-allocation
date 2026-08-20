const { Client } = require("pg");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Default: ILLT transport company ID (production/dev). Override via CLI arg or env.
const DEFAULT_COMPANY_ID = "4e2028b4-e489-4709-b9c8-9430747cb848";
const transportCompanyId = process.argv[2] || process.env.VACANCY_BLOCKS_COMPANY_ID || DEFAULT_COMPANY_ID;

const BLOCKS = [
  {
    sortOrder: 1,
    name: "Cargo Van (Small) R2.0 - Inside Natural Gas - BR - Ciclo 1",
    eligibleVehicleTypes: ["GNV"],
    cycle: 1,
  },
  {
    sortOrder: 2,
    name: "Cargo Van (Small) R2.0 - BR - Ciclo 1",
    eligibleVehicleTypes: ["CARGO_VAN"],
    cycle: 1,
  },
  {
    sortOrder: 3,
    name: "Standard Parcel - Small Van - BR - Ciclo 2",
    eligibleVehicleTypes: ["CARGO_VAN", "GNV"],
    cycle: 2,
  },
  {
    sortOrder: 4,
    name: "Same Day Passenger Car - Ciclo 2",
    eligibleVehicleTypes: ["PASSENGER"],
    cycle: 2,
  },
];

async function main() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Verify transport company exists
    const companyResult = await client.query(
      `SELECT id, name FROM "transport_companies" WHERE id = $1`,
      [transportCompanyId]
    );
    if (companyResult.rows.length === 0) {
      console.error(`Transport company ${transportCompanyId} not found.`);
      process.exit(1);
    }
    console.log(`Seeding vacancy blocks for: ${companyResult.rows[0].name} (${transportCompanyId})`);

    let created = 0;
    let skipped = 0;

    for (const block of BLOCKS) {
      // Idempotent: check by name + transportCompanyId
      const existing = await client.query(
        `SELECT id FROM "vacancy_blocks" WHERE name = $1 AND "transportCompanyId" = $2`,
        [block.name, transportCompanyId]
      );

      if (existing.rows.length > 0) {
        console.log(`  SKIP (exists): ${block.name}`);
        skipped++;
        continue;
      }

      // Convert eligibleVehicleTypes to PostgreSQL array literal
      const typesArray = `{${block.eligibleVehicleTypes.join(",")}}`;

      await client.query(
        `INSERT INTO "vacancy_blocks"
          ("id", "transportCompanyId", "name", "cycle", "eligibleVehicleTypes", "active", "sortOrder", "createdAt", "updatedAt")
         VALUES
          (gen_random_uuid(), $1, $2, $3, $4::"VehicleEligibility"[], true, $5, now(), now())`,
        [transportCompanyId, block.name, block.cycle, typesArray, block.sortOrder]
      );
      console.log(`  CREATED: ${block.name}`);
      created++;
    }

    console.log(`\nDone: ${created} created, ${skipped} skipped.`);

    // Validation
    const validation = await client.query(
      `SELECT "sortOrder", "name", "cycle", "eligibleVehicleTypes", "active"
       FROM "vacancy_blocks"
       WHERE "transportCompanyId" = $1
       ORDER BY "sortOrder"`,
      [transportCompanyId]
    );
    console.log("\nCurrent blocks for this company:");
    console.table(validation.rows);
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
