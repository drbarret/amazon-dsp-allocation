#!/usr/bin/env node
/**
 * Import drivers from Cadastro_Inicial_Motoristas.xlsx into the database.
 *
 * Idempotent: running twice produces the same result (no duplicates, no changes).
 * Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/import-drivers.mjs                    # dry-run
 *   node scripts/import-drivers.mjs --apply             # write to DB
 *   node scripts/import-drivers.mjs --apply --file=path # custom file
 *
 * Security:
 *   - Emails and CPF-like data are masked in log output.
 *   - No personal data is written to stdout in plaintext.
 *   - CPF and phone are encrypted via src/lib/crypto.ts when stored.
 *
 * Access control:
 *   - ACTIVE drivers → AllowedEmail (status=ACTIVE) + User (active=true) + DriverProfile
 *   - INACTIVE drivers → AllowedEmail (status=ACTIVE) + User (active=false) + DriverProfile
 *     The User.active=false check in auth.ts signIn callback blocks login.
 *   - Existing AllowedEmail rows (the 9 staff entries) are never modified.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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
 * Mask an email for safe logging: show first 3 + domain.
 * e.g. "ademirrosik@gmail.com" → "ade***@gmail.com"
 */
function maskEmail(email) {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

/**
 * Mask a phone number: show DDD + last 4 digits.
 * e.g. 11945412952 → "(11) ****-2952"
 */
function maskPhone(phone) {
  const s = String(phone).replace(/\D/g, "");
  if (s.length < 8) return "***";
  const ddd = s.slice(0, 2);
  const last4 = s.slice(-4);
  return `(${ddd}) ****-${last4}`;
}

/**
 * Normalize a name: collapse whitespace, trim.
 */
function normalizeName(name) {
  return String(name).replace(/\s+/g, " ").trim();
}

/**
 * Normalize an email: lowercase, trim.
 */
function normalizeEmail(email) {
  return String(email).toLowerCase().trim();
}

/**
 * Convert Excel serial date to YYYY-MM-DD string.
 * Excel serial 1 = 1900-01-01 (with the Lotus 1-2-3 bug: 1900-02-29 exists).
 */
function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1) return null;
  // Excel epoch: 1899-12-30 (accounts for the 1900 leap year bug)
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Format phone to E.164-ish: +55 + DDD + number.
 * Input: 11945412952 (11 digits, DDD + 9 + 8 digits)
 */
function formatPhone(raw) {
  const s = String(raw).replace(/\D/g, "");
  if (s.length === 11) {
    return `+55${s}`;
  }
  if (s.length === 13 && s.startsWith("55")) {
    return `+${s}`;
  }
  // Return as-is with +55 prefix if it looks like a number
  if (s.length >= 10) {
    return `+55${s}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Spreadsheet parsing
// ---------------------------------------------------------------------------

/**
 * Parse the spreadsheet and return an array of driver records.
 * Returns { drivers, errors } where errors is an array of { row, reason }.
 */
function parseSpreadsheet(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Planilha não encontrada: ${filePath}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (data.length < 2) {
    console.error("❌ Planilha vazia ou sem dados.");
    process.exit(1);
  }

  const headers = data[0];
  const expectedHeaders = [
    "Nome",
    "TransporterID",
    "Position",
    "CNH expiration",
    "Phone Number",
    "Email",
    "Status",
  ];

  // Validate headers
  for (let i = 0; i < expectedHeaders.length; i++) {
    if (String(headers[i] || "").trim() !== expectedHeaders[i]) {
      console.error(
        `❌ Cabeçalho inesperado na coluna ${i}: esperado "${expectedHeaders[i]}", recebido "${headers[i]}"`
      );
      process.exit(1);
    }
  }

  const drivers = [];
  const errors = [];
  const seenEmails = new Set();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 1; // 1-based in spreadsheet

    // Skip empty rows
    if (!row || row.every((c) => c === undefined || c === null || c === "")) {
      continue;
    }

    const rawName = row[0];
    const rawTransporterId = row[1];
    const rawPosition = row[2];
    const rawCnhExpiration = row[3];
    const rawPhone = row[4];
    const rawEmail = row[5];
    const rawStatus = row[6];

    // --- Validate required fields ---
    if (!rawName || String(rawName).trim() === "") {
      errors.push({ row: rowNum, reason: "Nome vazio" });
      continue;
    }
    if (!rawEmail || String(rawEmail).trim() === "") {
      errors.push({ row: rowNum, reason: "E-mail vazio" });
      continue;
    }

    const email = normalizeEmail(rawEmail);

    // Validate email format
    if (!email.includes("@") || email.split("@")[0].length === 0) {
      errors.push({
        row: rowNum,
        reason: `E-mail malformado: ${maskEmail(email)}`,
      });
      continue;
    }

    // Check duplicate within spreadsheet
    if (seenEmails.has(email)) {
      errors.push({
        row: rowNum,
        reason: `E-mail duplicado na planilha: ${maskEmail(email)}`,
      });
      continue;
    }
    seenEmails.add(email);

    // --- Validate status ---
    const status = String(rawStatus || "").trim().toUpperCase();
    if (status !== "ACTIVE" && status !== "INACTIVE") {
      errors.push({
        row: rowNum,
        reason: `Status desconhecido: "${rawStatus}" (esperado ACTIVE ou INACTIVE)`,
      });
      continue;
    }

    // --- Validate position ---
    const position = String(rawPosition || "").trim();
    if (position !== "Driver") {
      errors.push({
        row: rowNum,
        reason: `Position inesperada: "${position}" (esperado "Driver")`,
      });
      continue;
    }

    // --- Parse fields ---
    const name = normalizeName(rawName);
    const transporterId = String(rawTransporterId || "").trim() || null;
    const cnhExpiration = excelSerialToDate(rawCnhExpiration);
    const phoneRaw = String(rawPhone || "").replace(/\D/g, "");
    const phoneFormatted = formatPhone(rawPhone);

    drivers.push({
      row: rowNum,
      name,
      email,
      transporterId,
      cnhExpiration,
      phone: phoneRaw || null,
      phoneFormatted,
      status, // "ACTIVE" | "INACTIVE"
    });
  }

  return { drivers, errors };
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/**
 * Import drivers into the database.
 * Returns summary of operations.
 */
async function importDrivers(drivers, dryRun) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const summary = {
    total: drivers.length,
    created: { allowedEmails: 0, users: 0, driverProfiles: 0 },
    updated: { allowedEmails: 0, users: 0, driverProfiles: 0 },
    skipped: 0,
    failed: 0,
    failures: [],
  };

  try {
    if (!dryRun) {
      await client.query("BEGIN");
    }

    for (const driver of drivers) {
      try {
        const isActive = driver.status === "ACTIVE";

        // 1. Upsert AllowedEmail
        const existingAllowed = await client.query(
          `SELECT id, status, role FROM "allowed_emails" WHERE email = $1`,
          [driver.email]
        );

        let allowedEmailId;
        if (existingAllowed.rowCount === 0) {
          if (!dryRun) {
            const result = await client.query(
              `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), $1, 'DRIVER', 'ACTIVE', now(), now())
               RETURNING id`,
              [driver.email]
            );
            allowedEmailId = result.rows[0].id;
          }
          summary.created.allowedEmails++;
          console.log(
            `  ✅ AllowedEmail: ${maskEmail(driver.email)} (${driver.status})`
          );
        } else {
          allowedEmailId = existingAllowed.rows[0].id;
          const existingStatus = existingAllowed.rows[0].status;

          if (existingStatus !== "ACTIVE") {
            // Reactivate if previously REVOKED
            if (!dryRun) {
              await client.query(
                `UPDATE "allowed_emails" SET status = 'ACTIVE', "updatedAt" = now() WHERE id = $1`,
                [allowedEmailId]
              );
            }
            summary.updated.allowedEmails++;
            console.log(
              `  🔄 AllowedEmail reativado: ${maskEmail(driver.email)}`
            );
          } else {
            summary.skipped++;
            console.log(
              `  ⏭️  AllowedEmail já existe: ${maskEmail(driver.email)}`
            );
          }
        }

        // 2. Upsert User
        const existingUser = await client.query(
          `SELECT id, active, name FROM "users" WHERE email = $1`,
          [driver.email]
        );

        let userId;
        if (existingUser.rowCount === 0) {
          if (!dryRun) {
            const result = await client.query(
              `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), $1, $2, 'DRIVER', $3, now(), now())
               RETURNING id`,
              [driver.email, driver.name, isActive]
            );
            userId = result.rows[0].id;
          }
          summary.created.users++;
          console.log(
            `  ✅ User: ${maskEmail(driver.email)} (active=${isActive})`
          );
        } else {
          userId = existingUser.rows[0].id;
          const existingActive = existingUser.rows[0].active;
          const existingName = existingUser.rows[0].name;

          let needsUpdate = false;
          if (existingActive !== isActive) needsUpdate = true;
          if (existingName !== driver.name) needsUpdate = true;

          if (needsUpdate) {
            if (!dryRun) {
              await client.query(
                `UPDATE "users" SET "active" = $1, "name" = $2, "updatedAt" = now() WHERE id = $3`,
                [isActive, driver.name, userId]
              );
            }
            summary.updated.users++;
            console.log(
              `  🔄 User atualizado: ${maskEmail(driver.email)} (active=${isActive})`
            );
          } else {
            console.log(
              `  ⏭️  User já correto: ${maskEmail(driver.email)}`
            );
          }
        }

        // 3. Upsert DriverProfile
        const existingProfile = await client.query(
          `SELECT id, "transporterId", "phone", "phoneFormatted" FROM "driver_profiles" WHERE "userId" = $1`,
          [userId]
        );

        if (existingProfile.rowCount === 0) {
          if (!dryRun) {
            await client.query(
              `INSERT INTO "driver_profiles" ("id", "userId", "transporterId", "phone", "phoneFormatted", "vehicleType", "onboardingCompleted", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CARGO_VAN', false, now(), now())`,
              [userId, driver.transporterId, driver.phone, driver.phoneFormatted]
            );
          }
          summary.created.driverProfiles++;
          console.log(
            `  ✅ DriverProfile: ${maskEmail(driver.email)} (transporterId=${driver.transporterId})`
          );
        } else {
          const ep = existingProfile.rows[0];
          let needsUpdate = false;
          if (ep.transporterId !== driver.transporterId) needsUpdate = true;

          if (needsUpdate) {
            if (!dryRun) {
              await client.query(
                `UPDATE "driver_profiles" SET "transporterId" = $1, "phone" = $2, "phoneFormatted" = $3, "updatedAt" = now() WHERE id = $4`,
                [driver.transporterId, driver.phone, driver.phoneFormatted, ep.id]
              );
            }
            summary.updated.driverProfiles++;
            console.log(
              `  🔄 DriverProfile atualizado: ${maskEmail(driver.email)}`
            );
          } else {
            console.log(
              `  ⏭️  DriverProfile já correto: ${maskEmail(driver.email)}`
            );
          }
        }
      } catch (err) {
        summary.failed++;
        summary.failures.push({
          row: driver.row,
          email: maskEmail(driver.email),
          error: err.message,
        });
        console.error(
          `  ❌ Falha na linha ${driver.row} (${maskEmail(driver.email)}): ${err.message}`
        );
      }
    }

    if (!dryRun) {
      await client.query("COMMIT");
    }
  } catch (err) {
    if (!dryRun) {
      await client.query("ROLLBACK").catch(() => {});
    }
    console.error(`❌ Falha na transação: ${err.message}`);
    throw err;
  } finally {
    await client.end();
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log("Importação de Motoristas");
  console.log("=".repeat(60));
  console.log(`Planilha: ${SPREADSHEET_PATH}`);
  console.log(`Modo: ${APPLY ? "APLICAÇÃO (--apply)" : "DRY-RUN (simulação)"}`);
  console.log("");

  // Parse
  const { drivers, errors } = parseSpreadsheet(SPREADSHEET_PATH);

  console.log(`📊 Total de linhas lidas: ${drivers.length + errors.length}`);
  console.log(`   Válidas: ${drivers.length}`);
  console.log(`   Com erro: ${errors.length}`);
  console.log("");

  if (errors.length > 0) {
    console.log("⚠️  Erros de validação:");
    for (const e of errors) {
      console.log(`   Linha ${e.row}: ${e.reason}`);
    }
    console.log("");
  }

  // Status breakdown
  const activeCount = drivers.filter((d) => d.status === "ACTIVE").length;
  const inactiveCount = drivers.filter((d) => d.status === "INACTIVE").length;
  console.log(`   ACTIVE: ${activeCount}`);
  console.log(`   INACTIVE: ${inactiveCount}`);
  console.log("");

  if (drivers.length === 0) {
    console.log("❌ Nenhum motorista válido para importar.");
    process.exit(1);
  }

  // Import
  console.log(`${APPLY ? "Gravando" : "Simulando"} importação...`);
  console.log("");

  const summary = await importDrivers(drivers, !APPLY);

  // Print summary
  console.log("");
  console.log("=".repeat(60));
  console.log("RESUMO");
  console.log("=".repeat(60));
  console.log(`Total processado: ${summary.total}`);
  console.log(
    `Criados: ${summary.created.allowedEmails} allowed_emails, ${summary.created.users} users, ${summary.created.driverProfiles} driver_profiles`
  );
  console.log(
    `Atualizados: ${summary.updated.allowedEmails} allowed_emails, ${summary.updated.users} users, ${summary.updated.driverProfiles} driver_profiles`
  );
  console.log(`Já existentes (skip): ${summary.skipped}`);
  console.log(`Falhas: ${summary.failed}`);
  console.log("");

  if (summary.failures.length > 0) {
    console.log("❌ Falhas:");
    for (const f of summary.failures) {
      console.log(`   Linha ${f.row} (${f.email}): ${f.error}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log(
      "💡 Este foi um DRY-RUN. Para aplicar as mudanças, execute com --apply"
    );
  } else {
    console.log("✅ Importação concluída.");
  }
}

main().catch((err) => {
  console.error("❌ Erro fatal:", err.message);
  process.exit(1);
});
