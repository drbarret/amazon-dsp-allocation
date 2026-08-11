#!/usr/bin/env node
// Testa conectividade com PostgreSQL usando a variável DATABASE_URL.
// Uso: node scripts/test-db.mjs

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

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("❌ DATABASE_URL não está definida no ambiente.");
  process.exit(1);
}

console.log("🧪 Testando conectividade com PostgreSQL...");

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const result = await client.query("SELECT 1 AS postgres_ok");
  console.log("✅ PostgreSQL está acessível:", result.rows[0]);
  await client.end();
} catch (err) {
  console.error("❌ Falha ao conectar no PostgreSQL.", err.message);
  await client.end().catch(() => {});
  process.exit(1);
}
