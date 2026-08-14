/**
 * Parser and normalizer for the driver import spreadsheet.
 *
 * Extracted from scripts/import-drivers.mjs so it can be unit-tested.
 * All functions are pure — no side effects, no database access.
 */

/**
 * Mask an email for safe logging: show first 3 + domain.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

/**
 * Mask a phone number: show DDD + last 4 digits.
 */
export function maskPhone(phone: string | number): string {
  const s = String(phone).replace(/\D/g, "");
  if (s.length < 8) return "***";
  const ddd = s.slice(0, 2);
  const last4 = s.slice(-4);
  return `(${ddd}) ****-${last4}`;
}

/**
 * Normalize a name: collapse whitespace, trim.
 */
export function normalizeName(name: string): string {
  return String(name).replace(/\s+/g, " ").trim();
}

/**
 * Normalize an email: lowercase, trim.
 */
export function normalizeEmail(email: string): string {
  return String(email).toLowerCase().trim();
}

/**
 * Convert Excel serial date to YYYY-MM-DD string.
 * Excel serial 1 = 1900-01-01 (with the Lotus 1-2-3 bug: 1900-02-29 exists).
 */
export function excelSerialToDate(serial: number | string | undefined | null): string | null {
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
 */
export function formatPhone(raw: string | number | undefined | null): string | null {
  const s = String(raw ?? "").replace(/\D/g, "");
  if (s.length === 11) {
    return `+55${s}`;
  }
  if (s.length === 13 && s.startsWith("55")) {
    return `+${s}`;
  }
  if (s.length >= 10) {
    return `+55${s}`;
  }
  return null;
}

/**
 * Validate an email string.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.trim() === "") {
    return "E-mail vazio";
  }
  if (!normalized.includes("@")) {
    return "E-mail sem @";
  }
  const [local, domain] = normalized.split("@");
  if (!local || local.length === 0) {
    return "E-mail sem parte local";
  }
  if (!domain || !domain.includes(".")) {
    return "E-mail sem domínio válido";
  }
  return null;
}

/**
 * Validate a status string.
 * Returns the normalized status ("ACTIVE" | "INACTIVE") or null if invalid.
 */
export function validateStatus(raw: string | undefined | null): "ACTIVE" | "INACTIVE" | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "ACTIVE" || s === "INACTIVE") {
    return s;
  }
  return null;
}

export interface DriverRecord {
  row: number;
  name: string;
  email: string;
  transporterId: string | null;
  cnhExpiration: string | null;
  phone: string | null;
  phoneFormatted: string | null;
  status: "ACTIVE" | "INACTIVE";
}

export interface ParseError {
  row: number;
  reason: string;
}

export interface ParseResult {
  drivers: DriverRecord[];
  errors: ParseError[];
}

/**
 * Parse a single row from the spreadsheet (array of 7 values).
 * Returns a DriverRecord or a ParseError.
 */
export function parseRow(
  rowData: unknown[],
  rowNum: number,
  seenEmails: Set<string>
): DriverRecord | ParseError {
  const rawName = rowData[0];
  const rawTransporterId = rowData[1];
  const rawPosition = rowData[2];
  const rawCnhExpiration = rowData[3];
  const rawPhone = rowData[4];
  const rawEmail = rowData[5];
  const rawStatus = rowData[6];

  // --- Validate required fields ---
  if (!rawName || String(rawName).trim() === "") {
    return { row: rowNum, reason: "Nome vazio" };
  }

  const emailError = validateEmail(String(rawEmail ?? ""));
  if (emailError) {
    return { row: rowNum, reason: emailError };
  }

  const email = normalizeEmail(String(rawEmail));

  // Check duplicate within batch
  if (seenEmails.has(email)) {
    return {
      row: rowNum,
      reason: `E-mail duplicado na planilha: ${maskEmail(email)}`,
    };
  }
  seenEmails.add(email);

  // --- Validate status ---
  const status = validateStatus(String(rawStatus ?? ""));
  if (!status) {
    return {
      row: rowNum,
      reason: `Status desconhecido: "${rawStatus}" (esperado ACTIVE ou INACTIVE)`,
    };
  }

  // --- Validate position ---
  const position = String(rawPosition ?? "").trim();
  if (position !== "Driver") {
    return {
      row: rowNum,
      reason: `Position inesperada: "${position}" (esperado "Driver")`,
    };
  }

  // --- Parse fields ---
  const name = normalizeName(String(rawName));
  const transporterId = String(rawTransporterId ?? "").trim() || null;
  const cnhExpiration = excelSerialToDate(rawCnhExpiration as number | string | undefined | null);
  const phoneRaw = String(rawPhone ?? "").replace(/\D/g, "") || null;
  const phoneFormatted = formatPhone(rawPhone as string | number | undefined | null);

  return {
    row: rowNum,
    name,
    email,
    transporterId,
    cnhExpiration,
    phone: phoneRaw,
    phoneFormatted,
    status,
  };
}

/**
 * Parse all rows from a spreadsheet data array (header + rows).
 */
export function parseAllRows(data: unknown[][]): ParseResult {
  const drivers: DriverRecord[] = [];
  const errors: ParseError[] = [];
  const seenEmails = new Set<string>();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 1; // 1-based in spreadsheet

    // Skip empty rows
    if (!row || row.every((c) => c === undefined || c === null || c === "")) {
      continue;
    }

    const result = parseRow(row, rowNum, seenEmails);
    if ("reason" in result) {
      errors.push(result);
    } else {
      drivers.push(result);
    }
  }

  return { drivers, errors };
}
