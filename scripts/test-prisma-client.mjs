#!/usr/bin/env node
// Testa a conectividade usando o Prisma Client gerado com driver adapter.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/index.js";
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL não está definida.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

try {
  const result = await prisma.$queryRaw`SELECT 1 AS prisma_ok`;
  console.log("✅ Prisma Client conectou:", result);
} catch (err) {
  console.error("❌ Falha no Prisma Client:", err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
