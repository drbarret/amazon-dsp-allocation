import "server-only";

import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

export interface AvailabilityRecord {
  row: number;
  filledAt: Date | null;
  email: string;
  name: string | null;
  cpf: string | null;
  hasNaturalGas: boolean;
  isPassengerCar: boolean;
  sunAvailable: boolean;
  monAvailable: boolean;
  tueAvailable: boolean;
  wedAvailable: boolean;
  thuAvailable: boolean;
  friAvailable: boolean;
  satAvailable: boolean;
  speedAfternoon: boolean;
  userId: string;
}

export interface AvailabilityWarning {
  row: number;
  email: string | null;
  name: string | null;
  cpf: string | null;
  reason: string;
  userId?: string | null;
  filledAt: Date | null;
  hasNaturalGas: boolean;
  isPassengerCar: boolean;
  sunAvailable: boolean;
  monAvailable: boolean;
  tueAvailable: boolean;
  wedAvailable: boolean;
  thuAvailable: boolean;
  friAvailable: boolean;
  satAvailable: boolean;
  speedAfternoon: boolean;
}

export interface AvailabilityError {
  row: number;
  reason: string;
}

export interface ParseSummary {
  week: string;
  totalRows: number;
  active: number;
  inactive: number;
  invalid: number;
}

export interface ParseResult {
  availabilities: AvailabilityRecord[];
  warnings: AvailabilityWarning[];
  errors: AvailabilityError[];
  summary: ParseSummary;
}

export interface ParseOptions {
  findUsersByEmails?: (
    emails: string[]
  ) => Promise<Array<{ id: string; email: string; role: string; active: boolean }>>;
}

const MIN_COLUMNS = 14;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: unknown): string {
  return String(email ?? "").toLowerCase().trim();
}

export function validateEmail(email: string): string | null {
  if (!email || email.trim() === "") {
    return "E-mail ausente";
  }
  if (!EMAIL_REGEX.test(email)) {
    return `E-mail inválido: ${email}`;
  }
  return null;
}

export function parseYesNo(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "sim";
}

export function cleanCpf(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

export function parseDateTime(value: unknown): Date | null {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    // Excel serial date. Excel epoch: 1899-12-30.
    const ms = (value - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(value ?? "").trim();
  if (!str) return null;

  // dd/MM/yyyy HH:mm:ss or dd/MM/yyyy H:mm:ss
  // Timestamps in the spreadsheet come from Brazilian drivers, so treat them
  // as America/Sao_Paulo (BRT = UTC-3) for a consistent instant regardless of
  // the runtime timezone.
  const match = str.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
  );
  if (match) {
    const [, day, month, year, hour, minute, second] = match;
    const pad = (n: string) => n.padStart(2, "0");
    const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${minute}:${second}-03:00`;
    const d = new Date(iso);
    if (
      d.getUTCDate() === Number(day) &&
      d.getUTCMonth() === Number(month) - 1 &&
      d.getUTCFullYear() === Number(year)
    ) {
      return d;
    }
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function isRowEmpty(row: unknown[]): boolean {
  return row.every((cell) => cell === undefined || cell === null || String(cell).trim() === "");
}

function validateHeaders(headers: unknown[]): string | null {
  if (headers.length < MIN_COLUMNS) {
    return `Cabeçalho incompleto: esperado pelo menos ${MIN_COLUMNS} colunas (A–N), encontrado ${headers.length}`;
  }
  return null;
}

interface ParsedRow {
  row: number;
  filledAt: Date | null;
  email: string;
  name: string | null;
  cpf: string | null;
  hasNaturalGas: boolean;
  isPassengerCar: boolean;
  sunAvailable: boolean;
  monAvailable: boolean;
  tueAvailable: boolean;
  wedAvailable: boolean;
  thuAvailable: boolean;
  friAvailable: boolean;
  satAvailable: boolean;
  speedAfternoon: boolean;
}

function parseRow(row: unknown[], rowIndex: number): ParsedRow | AvailabilityError {
  if (row.length < MIN_COLUMNS) {
    return { row: rowIndex, reason: `Linha incompleta: esperado ${MIN_COLUMNS} colunas` };
  }

  const email = normalizeEmail(row[1]);
  const emailError = validateEmail(email);
  if (emailError) {
    return { row: rowIndex, reason: emailError };
  }

  return {
    row: rowIndex,
    filledAt: parseDateTime(row[0]),
    email,
    name: String(row[2] ?? "").trim() || null,
    cpf: cleanCpf(row[3]),
    hasNaturalGas: parseYesNo(row[4]),
    isPassengerCar: parseYesNo(row[5]),
    sunAvailable: parseYesNo(row[6]),
    monAvailable: parseYesNo(row[7]),
    tueAvailable: parseYesNo(row[8]),
    wedAvailable: parseYesNo(row[9]),
    thuAvailable: parseYesNo(row[10]),
    friAvailable: parseYesNo(row[11]),
    satAvailable: parseYesNo(row[12]),
    speedAfternoon: parseYesNo(row[13]),
  };
}

async function defaultFindUsersByEmails(
  emails: string[]
): Promise<Array<{ id: string; email: string; role: string; active: boolean }>> {
  return prisma.user.findMany({
    where: {
      email: { in: emails },
    },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
    },
  });
}

export async function parseXlsxAvailability(
  file: Buffer | ArrayBuffer,
  week: string,
  options?: ParseOptions
): Promise<ParseResult> {
  if (!week || week.trim() === "") {
    throw new Error("Semana não informada");
  }

  const workbook = XLSX.read(file, { type: "buffer", cellDates: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) {
    throw new Error("Planilha vazia");
  }

  const data = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
  if (data.length < 2) {
    throw new Error("Planilha vazia ou sem dados");
  }

  const headers = data[0];
  const headerError = validateHeaders(headers);
  if (headerError) {
    throw new Error(headerError);
  }

  const parsedRows: ParsedRow[] = [];
  const errors: AvailabilityError[] = [];

  for (let i = 1; i < data.length; i++) {
    const rawRow = data[i];
    if (!Array.isArray(rawRow)) continue;

    const row = rawRow.map((cell) => cell);
    if (isRowEmpty(row)) continue;

    const result = parseRow(row, i + 1);
    if ("reason" in result) {
      errors.push(result);
    } else {
      parsedRows.push(result);
    }
  }

  const findUsers = options?.findUsersByEmails ?? defaultFindUsersByEmails;
  const users = await findUsers(parsedRows.map((r) => r.email));
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  const availabilities: AvailabilityRecord[] = [];
  const warnings: AvailabilityWarning[] = [];

  for (const row of parsedRows) {
    const user = userByEmail.get(row.email);
    if (user && user.role === "DRIVER" && user.active) {
      availabilities.push({ ...row, userId: user.id });
    } else {
      warnings.push({
        row: row.row,
        email: row.email,
        name: row.name,
        cpf: row.cpf,
        reason: user
          ? `Motorista encontrado mas não está ativo (role=${user.role}, active=${user.active})`
          : "Motorista não encontrado no sistema",
        userId: user ? user.id : null,
        filledAt: row.filledAt,
        hasNaturalGas: row.hasNaturalGas,
        isPassengerCar: row.isPassengerCar,
        sunAvailable: row.sunAvailable,
        monAvailable: row.monAvailable,
        tueAvailable: row.tueAvailable,
        wedAvailable: row.wedAvailable,
        thuAvailable: row.thuAvailable,
        friAvailable: row.friAvailable,
        satAvailable: row.satAvailable,
        speedAfternoon: row.speedAfternoon,
      });
    }
  }

  const summary: ParseSummary = {
    week,
    totalRows: parsedRows.length + errors.length,
    active: availabilities.length,
    inactive: warnings.length,
    invalid: errors.length,
  };

  return { availabilities, warnings, errors, summary };
}
