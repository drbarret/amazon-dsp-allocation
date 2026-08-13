#!/usr/bin/env node
// Seed initial staff into AllowedEmail table.
// Idempotent: safe to re-run, upserts by email.
// Also updates existing User rows to match the intended role.
// Usage: node scripts/seed-staff.mjs

import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no env file; use shell vars
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("❌ DATABASE_URL não está definida.");
  process.exit(1);
}

const STAFF = [
  { name: "Gustavo Alves", email: "gustavo.alves@instalog.com.br", role: "SUPERVISOR" },
  { name: "Maria Achete", email: "maria.achete@instalog.com.br", role: "SUPERVISOR" },
  { name: "Natan Pupo", email: "natan.pupo@instalog.com.br", role: "SUPERVISOR" },
  { name: "Ricardo De Souza", email: "ricardo.souza@instalog.com.br", role: "SUPERVISOR" },
  { name: "Erica Andrade", email: "erica.andrade@instalog.com.br", role: "ACCOUNT_MANAGER" },
  { name: "Daniel Ribeiro", email: "daniel.barreto@instalog.com.br", role: "ACCOUNT_MANAGER" },
  { name: "Sara Monteiro", email: "sara.monteiro@instalog.com.br", role: "ACCOUNT_MANAGER" },
  { name: "Marcio Spontao", email: "marcio.spontao@instalog.com.br", role: "ACCOUNT_MANAGER" },
  { name: "Daniel Ribeiro Barreto", email: "drbarret@gmail.com", role: "ADMIN" },
];

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });
await client.connect();

let created = 0;
let updated = 0;
let skipped = 0;

try {
  await client.query("BEGIN");

  for (const person of STAFF) {
    const normalizedEmail = person.email.toLowerCase().trim();

    // Upsert AllowedEmail
    const existing = await client.query(
      `SELECT id, role, status FROM "allowed_emails" WHERE email = $1`,
      [normalizedEmail]
    );

    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now())`,
        [normalizedEmail, person.role]
      );
      console.log(`  ✅ AllowedEmail criado: ${normalizedEmail} → ${person.role}`);
      created++;
    } else {
      const row = existing.rows[0];
      if (row.role !== person.role || row.status !== "ACTIVE") {
        await client.query(
          `UPDATE "allowed_emails" SET role = $1, status = 'ACTIVE', "updatedAt" = now() WHERE email = $2`,
          [person.role, normalizedEmail]
        );
        console.log(`  🔄 AllowedEmail atualizado: ${normalizedEmail} → ${person.role}`);
        updated++;
      } else {
        console.log(`  ⏭️  AllowedEmail já correto: ${normalizedEmail} (${person.role})`);
        skipped++;
      }
    }

    // Update existing User row if present
    const userRow = await client.query(
      `SELECT id, role FROM "users" WHERE email = $1`,
      [normalizedEmail]
    );
    if (userRow.rowCount > 0) {
      const u = userRow.rows[0];
      if (u.role !== person.role) {
        await client.query(
          `UPDATE "users" SET role = $1, "updatedAt" = now() WHERE email = $2`,
          [person.role, normalizedEmail]
        );
        console.log(`  🔄 User role atualizado: ${normalizedEmail} → ${person.role}`);
      } else {
        console.log(`  ⏭️  User role já correto: ${normalizedEmail} (${person.role})`);
      }
    }
  }

  await client.query("COMMIT");

  console.log(`\n📊 Resumo: ${created} criados, ${updated} atualizados, ${skipped} já corretos.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("❌ Falha ao semear staff:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
