#!/usr/bin/env node
// Aplica uma migration SQL gerada pelo Prisma diretamente via pg.Client.
// Usado como fallback quando o schema engine do Prisma não consegue se
// comunicar com o pooler de conexões do Supabase.
// Uso: node scripts/apply-migration.mjs <caminho/migration.sql> [nome_da_migration]

import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {
    // nenhum arquivo de ambiente encontrado; usa variáveis do shell
  }
}

const filePath = process.argv[2];
const migrationName = process.argv[3] ?? "init";

if (!filePath) {
  console.error("❌ Informe o caminho do arquivo migration.sql.");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("❌ DATABASE_URL não está definida.");
  process.exit(1);
}

const sql = readFileSync(filePath, "utf-8");
const checksum = createHash("sha256").update(sql).digest("hex");

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });

await client.connect();

try {
  await client.query("BEGIN");
  await client.query(sql);

  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" varchar(36) PRIMARY KEY,
      "checksum" varchar(64) NOT NULL,
      "finished_at" timestamp with time zone DEFAULT now(),
      "migration_name" varchar(255) NOT NULL,
      "logs" text,
      "rolled_back_at" timestamp with time zone,
      "started_at" timestamp with time zone DEFAULT now()
    );
  `);

  // Evita inserir duplicado se a migration já foi aplicada.
  const existing = await client.query(
    `SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1`,
    [migrationName]
  );

  if (existing.rowCount === 0) {
    await client.query(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name")
       VALUES ($1, $2, now(), $3)`,
      [randomUUID(), checksum, migrationName]
    );
    console.log(`✅ Migration '${migrationName}' aplicada e registrada.`);
  } else {
    console.log(`ℹ️ Migration '${migrationName}' já estava registrada.`);
  }

  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("❌ Falha ao aplicar migration:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
