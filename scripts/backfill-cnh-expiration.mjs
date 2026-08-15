#!/usr/bin/env node
/**
 * Backfill `cnhExpiration` on the 124 already-imported driver profiles.
 *
 * The original import never persisted the CNH expiry date, so the expired-CNH
 * asterisk rule and the future expiry-reminder email have no data. This script
 * reads the source spreadsheet, matches each driver by email, and fills the
 * missing `cnhExpiration` value.
 *
 * Idempotent: running twice produces the same result (no changes on the 2nd
 * run). Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/backfill-cnh-expiration.mjs                    # dry-run
 *   node scripts/backfill-cnh-expiration.mjs --apply             # write to DB
 *   node scripts/backfill-cnh-expiration.mjs --apply --file=path # custom file
 *
 * Security:
 *   - Emails are masked in log output. No personal data in plaintext.
 *   - The spreadsheet is never committed.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parseSpreadsheet, maskEmail } from "./lib/spreadsheet-parser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "Cadastro_Inicial_Motoristas.xlsx"
);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const fileArg = args.find((a) => a.startsWith("--file="));
const SPREADSHEET_PATH = fileArg
  ? fileArg.slice("--file=".length)
  : DEFAULT_FILE;

// ---------------------------------------------------------------------------
// Load env
// ---------------------------------------------------------------------------

try {
  process.loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
} catch {
  try {
    process.loadEnvFile(path.resolve(__dirname, "..", ".env"));
  } catch {
    // no env file; use shell vars
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL não está definida.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a Date or date string to a YYYY-MM-DD string for comparison.
 * Returns null for null/undefined/invalid input.
 */
function toDateString(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log("Backfill de CNH Expiration");
  console.log("=".repeat(60));
  console.log(`Planilha: ${SPREADSHEET_PATH}`);
  console.log(`Modo: ${APPLY ? "APLICAÇÃO (--apply)" : "DRY-RUN (simulação)"}`);
  console.log("");

  // Parse
  const { drivers, errors } = parseSpreadsheet(SPREADSHEET_PATH);

  console.log(`📊 Linhas válidas na planilha: ${drivers.length}`);
  if (errors.length > 0) {
    console.log(`⚠️  Erros de validação (ignorados): ${errors.length}`);
    for (const e of errors) {
      console.log(`   Linha ${e.row}: ${e.reason}`);
    }
  }
  console.log("");

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const summary = {
    total: drivers.length,
    matched: 0,
    updated: 0,
    alreadyCorrect: 0,
    notFound: 0,
    failed: 0,
    failures: [],
  };

  try {
    if (APPLY) {
      await client.query("BEGIN");
    }

    for (const driver of drivers) {
      try {
        // Match by email through the users table.
        const userRes = await client.query(
          `SELECT id FROM "users" WHERE email = $1`,
          [driver.email]
        );
        if (userRes.rowCount === 0) {
          summary.notFound++;
          console.log(
            `  ⚠️  Sem usuário: ${maskEmail(driver.email)} (não encontrado)`
          );
          continue;
        }
        const userId = userRes.rows[0].id;

        const profileRes = await client.query(
          `SELECT id, "cnhExpiration" FROM "driver_profiles" WHERE "userId" = $1`,
          [userId]
        );
        if (profileRes.rowCount === 0) {
          summary.notFound++;
          console.log(
            `  ⚠️  Sem perfil: ${maskEmail(driver.email)} (não encontrado)`
          );
          continue;
        }

        summary.matched++;
        const profile = profileRes.rows[0];
        const current = toDateString(profile.cnhExpiration);
        const desired = driver.cnhExpiration;

        if (current === desired) {
          summary.alreadyCorrect++;
          console.log(
            `  ⏭️  Já correto: ${maskEmail(driver.email)} (cnh=${desired ?? "—"})`
          );
          continue;
        }

        if (APPLY) {
          await client.query(
            `UPDATE "driver_profiles" SET "cnhExpiration" = $1, "updatedAt" = now() WHERE id = $2`,
            [desired, profile.id]
          );
        }
        summary.updated++;
        console.log(
          `  🔄 ${APPLY ? "Atualizado" : "Atualizaria"}: ${maskEmail(driver.email)} (${current ?? "—"} → ${desired ?? "—"})`
        );
      } catch (err) {
        summary.failed++;
        summary.failures.push({
          email: maskEmail(driver.email),
          error: err.message,
        });
        console.error(
          `  ❌ Falha (${maskEmail(driver.email)}): ${err.message}`
        );
      }
    }

    if (APPLY) {
      await client.query("COMMIT");
    }
  } catch (err) {
    if (APPLY) {
      await client.query("ROLLBACK").catch(() => {});
    }
    console.error(`❌ Falha na transação: ${err.message}`);
    throw err;
  } finally {
    await client.end();
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("RESUMO");
  console.log("=".repeat(60));
  console.log(`Total na planilha: ${summary.total}`);
  console.log(`Casados por e-mail: ${summary.matched}`);
  console.log(`Atualizados: ${summary.updated}`);
  console.log(`Já corretos (skip): ${summary.alreadyCorrect}`);
  console.log(`Não encontrados: ${summary.notFound}`);
  console.log(`Falhas: ${summary.failed}`);
  console.log("");

  if (summary.failures.length > 0) {
    console.log("❌ Falhas:");
    for (const f of summary.failures) {
      console.log(`   ${f.email}: ${f.error}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log(
      "💡 Este foi um DRY-RUN. Para aplicar as mudanças, execute com --apply"
    );
  } else {
    console.log("✅ Backfill concluído.");
  }
}

main().catch((err) => {
  console.error("❌ Erro fatal:", err.message);
  process.exit(1);
});
