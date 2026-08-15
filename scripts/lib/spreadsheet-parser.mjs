/**
 * Shared spreadsheet parsing for the driver import / backfill scripts.
 *
 * Extracted so both `import-drivers.mjs` and `backfill-cnh-expiration.mjs`
 * reuse the exact same parsing logic (notably `excelSerialToDate`), instead
 * of each maintaining its own copy.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

/**
 * Mask an email for safe logging: show first 3 + domain.
 * e.g. "ademirrosik@gmail.com" → "ade***@gmail.com"
 */
export function maskEmail(email) {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

/**
 * Normalize a name: collapse whitespace, trim.
 */
export function normalizeName(name) {
  return String(name).replace(/\s+/g, " ").trim();
}

/**
 * Normalize an email: lowercase, trim.
 */
export function normalizeEmail(email) {
  return String(email).toLowerCase().trim();
}

/**
 * Convert Excel serial date to YYYY-MM-DD string.
 * Excel serial 1 = 1900-01-01 (with the Lotus 1-2-3 bug: 1900-02-29 exists).
 */
export function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1) return null;
  // Excel epoch: 1899-12-30 (accounts for the 1900 leap year bug)
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Parse the spreadsheet and return an array of driver records.
 * Returns { drivers, errors } where errors is an array of { row, reason }.
 */
export function parseSpreadsheet(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Planilha não encontrada: ${filePath}`);
  }

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (data.length < 2) {
    throw new Error("Planilha vazia ou sem dados.");
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

  for (let i = 0; i < expectedHeaders.length; i++) {
    if (String(headers[i] || "").trim() !== expectedHeaders[i]) {
      throw new Error(
        `Cabeçalho inesperado na coluna ${i}: esperado "${expectedHeaders[i]}", recebido "${headers[i]}"`
      );
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

    if (!rawName || String(rawName).trim() === "") {
      errors.push({ row: rowNum, reason: "Nome vazio" });
      continue;
    }
    if (!rawEmail || String(rawEmail).trim() === "") {
      errors.push({ row: rowNum, reason: "E-mail vazio" });
      continue;
    }

    const email = normalizeEmail(rawEmail);

    if (!email.includes("@") || email.split("@")[0].length === 0) {
      errors.push({
        row: rowNum,
        reason: `E-mail malformado: ${maskEmail(email)}`,
      });
      continue;
    }

    if (seenEmails.has(email)) {
      errors.push({
        row: rowNum,
        reason: `E-mail duplicado na planilha: ${maskEmail(email)}`,
      });
      continue;
    }
    seenEmails.add(email);

    const status = String(rawStatus || "").trim().toUpperCase();
    if (status !== "ACTIVE" && status !== "INACTIVE") {
      errors.push({
        row: rowNum,
        reason: `Status desconhecido: "${rawStatus}" (esperado ACTIVE ou INACTIVE)`,
      });
      continue;
    }

    const position = String(rawPosition || "").trim();
    if (position !== "Driver") {
      errors.push({
        row: rowNum,
        reason: `Position inesperada: "${position}" (esperado "Driver")`,
      });
      continue;
    }

    const name = normalizeName(rawName);
    const transporterId = String(rawTransporterId || "").trim() || null;
    const cnhExpiration = excelSerialToDate(rawCnhExpiration);
    const phoneRaw = String(rawPhone || "").replace(/\D/g, "");

    drivers.push({
      row: rowNum,
      name,
      email,
      transporterId,
      cnhExpiration,
      phone: phoneRaw || null,
      status,
    });
  }

  return { drivers, errors };
}
