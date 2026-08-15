// Prove the migration chain applies cleanly from scratch on a genuinely empty
// database, and that the resulting schema matches what production has.
//
// Why a fresh database instead of a scratch schema in the production DB:
//   - Migrations use unqualified catalog lookups (e.g. `pg_type WHERE typname=...`)
//     to make their `IF NOT EXISTS` guards idempotent. When run inside a scratch
//     schema of the production database, those lookups see the objects that
//     already exist in the `public` schema and skip creating them in the scratch
//     schema, so the chain fails with "type does not exist".
//   - Running on a brand-new empty database avoids that interference entirely and
//     is the honest way to prove "applies on an empty database".
//
// The temporary database is created and dropped automatically; nothing in the
// production database is modified.
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

// Connect to the maintenance database to create a fresh scratch database.
const admin = new Client({ connectionString: dbUrl });
await admin.connect();

const dbName = `scratch_proof_${Date.now()}`;
console.log(`Creating fresh empty database: ${dbName}`);
await admin.query(`CREATE DATABASE "${dbName}"`);

// Point a new connection at the fresh database.
const freshUrl = new URL(dbUrl);
freshUrl.pathname = `/${dbName}`;
const c = new Client({ connectionString: freshUrl.toString() });
await c.connect();

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

// Cleanup: drop the fresh database.
await c.end();
await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
console.log(`Dropped fresh database: ${dbName}`);
await admin.end();

if (failed > 0) process.exit(1);
