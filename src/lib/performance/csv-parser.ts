import { ScorecardClassification } from "@/generated/prisma";

export interface PerformanceCsvRow {
  row: number;
  name: string;
  transporterId: string;
  score: number;
  deliveredPackages: number;
  dcr: number; // 0-1 decimal
  dnr: number;
  classification: ScorecardClassification;
  rawClassification: string;
}

export interface PerformanceParseError {
  row: number;
  reason: string;
}

export interface PerformanceParseResult {
  rows: PerformanceCsvRow[];
  errors: PerformanceParseError[];
}

const CLASSIFICATION_BY_SCORE: {
  min: number;
  max: number;
  value: ScorecardClassification;
}[] = [
  { min: 0, max: 49, value: "POOR" },
  { min: 50, max: 69, value: "FAIR" },
  { min: 70, max: 89, value: "GREAT" },
  { min: 90, max: 94, value: "FANTASTIC" },
  { min: 95, max: 100, value: "FANTASTIC_PLUS" },
];

function scoreToClassification(score: number): ScorecardClassification {
  for (const range of CLASSIFICATION_BY_SCORE) {
    if (score >= range.min && score <= range.max) {
      return range.value;
    }
  }
  return "POOR";
}

function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function detectColumnIndex(headers: string[], possibleNames: string[]): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const name of possibleNames) {
    const idx = normalizedHeaders.indexOf(normalizeHeader(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseDcr(value: string): number | null {
  const trimmed = value.trim().replace("%", "").replace(",", ".");
  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  if (num > 1) return num / 100;
  return num;
}

function parseIntStrict(value: string): number | null {
  const num = Number(value.trim());
  if (Number.isNaN(num) || !Number.isInteger(num)) return null;
  return num;
}

function decodeWithFallback(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try {
    return utf8.decode(buffer);
  } catch {
    return new TextDecoder("iso-8859-1").decode(buffer);
  }
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (next === '"') {
          current += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === delimiter) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

export function parsePerformanceCsv(
  fileBuffer: ArrayBuffer,
  options: { delimiter?: string } = {},
): PerformanceParseResult {
  const delimiter = options.delimiter ?? ";";
  const text = decodeWithFallback(fileBuffer);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 0, reason: "Arquivo CSV vazio." }] };
  }

  const headers = splitCsvLine(lines[0], delimiter);

  const colName = detectColumnIndex(headers, ["nome", "name"]);
  const colTransporterId = detectColumnIndex(headers, [
    "transporterid",
    "transporter",
  ]);
  const colScore = detectColumnIndex(headers, ["score"]);
  const colDelivered = detectColumnIndex(headers, [
    "pacotesentregues",
    "entregues",
    "delivered",
    "pacotes",
  ]);
  const colDcr = detectColumnIndex(headers, ["dcr"]);
  const colDnr = detectColumnIndex(headers, ["dnr"]);

  const missing: string[] = [];
  if (colName === -1) missing.push("Nome");
  if (colTransporterId === -1) missing.push("TransporterID");
  if (colScore === -1) missing.push("Score");
  if (colDelivered === -1) missing.push("PacotesEntregues");
  if (colDcr === -1) missing.push("DCR");
  if (colDnr === -1) missing.push("DNR");

  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          reason: `Colunas obrigatórias não encontradas: ${missing.join(", ")}.`,
        },
      ],
    };
  }

  const rows: PerformanceCsvRow[] = [];
  const errors: PerformanceParseError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const cells = splitCsvLine(lines[i], delimiter);

    const name = cells[colName]?.trim() ?? "";
    const transporterId = cells[colTransporterId]?.trim() ?? "";
    const scoreRaw = cells[colScore]?.trim() ?? "";
    const deliveredRaw = cells[colDelivered]?.trim() ?? "";
    const dcrRaw = cells[colDcr]?.trim() ?? "";
    const dnrRaw = cells[colDnr]?.trim() ?? "";

    if (!name && !transporterId && !scoreRaw && !deliveredRaw) {
      continue;
    }

    if (!name) {
      errors.push({ row: lineNumber, reason: "Nome do motorista ausente." });
      continue;
    }
    if (!transporterId) {
      errors.push({ row: lineNumber, reason: "Transporter ID ausente." });
      continue;
    }

    const score = parseIntStrict(scoreRaw);
    if (score === null || score < 0 || score > 100) {
      errors.push({
        row: lineNumber,
        reason: `Score inválido: "${scoreRaw}".`,
      });
      continue;
    }

    const deliveredPackages = parseIntStrict(deliveredRaw);
    if (deliveredPackages === null || deliveredPackages < 0) {
      errors.push({
        row: lineNumber,
        reason: `Pacotes entregues inválido: "${deliveredRaw}".`,
      });
      continue;
    }

    const dcr = parseDcr(dcrRaw);
    if (dcr === null || dcr < 0 || dcr > 1) {
      errors.push({ row: lineNumber, reason: `DCR inválido: "${dcrRaw}".` });
      continue;
    }

    const dnr = parseIntStrict(dnrRaw);
    if (dnr === null || dnr < 0) {
      errors.push({ row: lineNumber, reason: `DNR inválido: "${dnrRaw}".` });
      continue;
    }

    const classification = scoreToClassification(score);

    rows.push({
      row: lineNumber,
      name,
      transporterId,
      score,
      deliveredPackages,
      dcr,
      dnr,
      classification,
      rawClassification: cells[colScore + 3]?.trim() ?? "",
    });
  }

  return { rows, errors };
}
