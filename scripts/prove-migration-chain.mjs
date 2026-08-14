// Prove migration chain works from scratch on a temporary schema.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const { Client } = pg;
const c = new Client({ connectionString: dbUrl });
await c.connect();

const schemaName = `scratch_migration_test_${Date.now()}`;
console.log(`Creating scratch schema: ${schemaName}`);
await c.query(`CREATE SCHEMA "${schemaName}"`);
await c.query(`SET search_path TO "${schemaName}"`);

const migrationsDir = join(process.cwd(), "prisma", "migrations");
const dirs = readdirSync(migrationsDir).sort();
console.log("Migration folders in order:");
dirs.forEach((d) => console.log(`  ${d}`));

let passed = 0;
let failed = 0;

for (const dir of dirs) {
  const sqlPath = join(migrationsDir, dir, "migration.sql");
  if (!existsSync(sqlPath)) {
    console.log(`  SKIP (no migration.sql): ${dir}`);
    continue;
  }
  const sql = readFileSync(sqlPath, "utf-8");
  try {
    await c.query(sql);
    console.log(`  OK: ${dir}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${dir} - ${err.message}`);
    failed++;
    break;
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed out of ${dirs.length}`);

// Cleanup
await c.query(`DROP SCHEMA "${schemaName}" CASCADE`);
console.log("Scratch schema dropped.");
await c.end();

if (failed > 0) process.exit(1);
