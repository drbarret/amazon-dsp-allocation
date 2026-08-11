#!/usr/bin/env node
// Testa conectividade com Redis usando a variável REDIS_URL.
// Uso: node scripts/test-redis.mjs

import { Redis } from "ioredis";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {
    // nenhum arquivo de ambiente encontrado; usa variáveis do shell
  }
}

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.error("❌ REDIS_URL não está definida no ambiente.");
  process.exit(1);
}

console.log("🧪 Testando conectividade com Redis...");

const redis = new Redis(redisUrl);

try {
  const pong = await redis.ping();
  console.log(`✅ Redis respondeu: ${pong}`);
  await redis.quit();
} catch (err) {
  console.error("❌ Falha ao conectar no Redis.", err.message);
  await redis.quit().catch(() => {});
  process.exit(1);
}
