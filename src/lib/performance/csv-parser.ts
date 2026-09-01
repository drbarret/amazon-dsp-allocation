import { ScorecardClassification } from "@/generated/prisma";
import * as XLSX from "xlsx";

export interface PerformanceRow {
  row: number;
  name: string;
  transporterId: string;
  scoreText: string;
  classification: ScorecardClassification;
  deliveredPackages: number;
  dcr: number; // 0-1 decimal
  dnr: number;
  insucessos: number; // float, imported directly from file
  contactCompliance: number; // 0-1 decimal
  swipeToFinishCompliance: number; // 0-1 decimal
  whc100: boolean;
}

export interface PerformanceParseError {
  row: number;
  reason: string;
}

export interface PerformanceParseResult {
  rows: PerformanceRow[];
  errors: PerformanceParseError[];
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

function parseDecimalOrPercent(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const trimmed = String(value).trim().replace("%", "").replace(",", ".");
  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  if (num > 1) return num / 100;
  return num;
}

function parseFloatStrict(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const trimmed = String(value).trim().replace(",", ".");
  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  return num;
}

function parseIntStrict(value: unknown): number | null {
  const num = parseFloatStrict(value);
  if (num === null || !Number.isInteger(num)) return null;
  return num;
}

function parseBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  const str = String(value).trim().toLowerCase();
  if (["yes", "sim", "s", "true", "1"].includes(str)) return true;
  if (["no", "não", "nao", "n", "false", "0"].includes(str)) return false;
  return null;
}

function scoreTextToClassification(
  scoreText: string,
): ScorecardClassification | null {
  const normalized = scoreText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9+]/g, "")
    .toLowerCase();

  if (["fantasticplus", "fantastic+", "f+"].includes(normalized)) {
    return "FANTASTIC_PLUS";
  }
  if (["fantastic", "fantastico", "f"].includes(normalized)) {
    return "FANTASTIC";
  }
  if (["great", "bom", "g"].includes(normalized)) {
    return "GREAT";
  }
  if (["fair", "razoavel", "razoável", "regular"].includes(normalized)) {
    return "FAIR";
  }
  if (["poor", "ruim"].includes(normalized)) {
    return "POOR";
  }
  return null;
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

function normalizeHeaders(rawHeaders: unknown[]): string[] {
  return rawHeaders.map((h) => String(h ?? "").trim());
}

function parseRow(
  cells: unknown[],
  lineNumber: number,
  columns: Record<string, number>,
): { row?: PerformanceRow; error?: PerformanceParseError } {
  const name = String(cells[columns.name] ?? "").trim();
  const transporterId = String(cells[columns.transporterId] ?? "").trim();
  const scoreText = String(cells[columns.score] ?? "").trim();
  const deliveredRaw = cells[columns.delivered];
  const dcrRaw = cells[columns.dcr];
  const insucessosRaw = cells[columns.insucessos];
  const dnrRaw = cells[columns.dnr];
  const contactRaw = cells[columns.contactCompliance];
  const swipeRaw = cells[columns.swipeToFinishCompliance];
  const whcRaw = cells[columns.whc100];

  if (!name && !transporterId && !scoreText && !deliveredRaw) {
    return {};
  }

  if (!name) {
    return { error: { row: lineNumber, reason: "Nome do motorista ausente." } };
  }
  if (!transporterId) {
    return { error: { row: lineNumber, reason: "Transporter ID ausente." } };
  }

  const classification = scoreTextToClassification(scoreText);
  if (!classification) {
    return {
      error: {
        row: lineNumber,
        reason: `Score inválido: "${scoreText}".`,
      },
    };
  }

  const deliveredPackages = parseIntStrict(deliveredRaw);
  if (deliveredPackages === null || deliveredPackages < 0) {
    return {
      error: {
        row: lineNumber,
        reason: `Pacotes entregues inválido: "${deliveredRaw}".`,
      },
    };
  }

  const dcr = parseDecimalOrPercent(dcrRaw);
  if (dcr === null || dcr < 0 || dcr > 1) {
    return { error: { row: lineNumber, reason: `DCR inválido: "${dcrRaw}".` } };
  }

  const insucessos = parseFloatStrict(insucessosRaw);
  if (insucessos === null || insucessos < 0) {
    return {
      error: {
        row: lineNumber,
        reason: `Insucessos inválido: "${insucessosRaw}".`,
      },
    };
  }

  const dnr = parseIntStrict(dnrRaw);
  if (dnr === null || dnr < 0) {
    return { error: { row: lineNumber, reason: `DNR inválido: "${dnrRaw}".` } };
  }

  const contactCompliance = parseDecimalOrPercent(contactRaw);
  if (contactCompliance === null || contactCompliance < 0 || contactCompliance > 1) {
    return {
      error: {
        row: lineNumber,
        reason: `Contact Compliance inválido: "${contactRaw}".`,
      },
    };
  }

  const swipeToFinishCompliance = parseDecimalOrPercent(swipeRaw);
  if (
    swipeToFinishCompliance === null ||
    swipeToFinishCompliance < 0 ||
    swipeToFinishCompliance > 1
  ) {
    return {
      error: {
        row: lineNumber,
        reason: `Swipe to Finish Compliance inválido: "${swipeRaw}".`,
      },
    };
  }

  const whc100 = parseBoolean(whcRaw);
  if (whc100 === null) {
    return {
      error: {
        row: lineNumber,
        reason: `100% WHC inválido: "${whcRaw}".`,
      },
    };
  }

  return {
    row: {
      row: lineNumber,
      name,
      transporterId,
      scoreText,
      classification,
      deliveredPackages,
      dcr,
      dnr,
      insucessos,
      contactCompliance,
      swipeToFinishCompliance,
      whc100,
    },
  };
}

function detectColumns(headers: string[]): {
  columns: Record<string, number>;
  missing: string[];
} {
  const colName = detectColumnIndex(headers, ["nome", "name"]);
  const colTransporterId = detectColumnIndex(headers, [
    "transporter id",
    "transporterid",
    "transporter",
  ]);
  const colScore = detectColumnIndex(headers, ["score"]);
  const colDelivered = detectColumnIndex(headers, [
    "pacotes entregues",
    "pacotesentregues",
    "entregues",
    "delivered",
    "pacotes",
  ]);
  const colDcr = detectColumnIndex(headers, ["dcr"]);
  const colInsucessos = detectColumnIndex(headers, [
    "insucessos",
    "insuccessos",
    "falhas",
  ]);
  const colDnr = detectColumnIndex(headers, ["dnr dpmo", "dnrdpmo", "dnr"]);
  const colContact = detectColumnIndex(headers, [
    "contact compliance",
    "contactcompliance",
    "contact",
  ]);
  const colSwipe = detectColumnIndex(headers, [
    "swipe to finish compliance",
    "swipetofinishcompliance",
    "swipe",
  ]);
  const colWhc = detectColumnIndex(headers, [
    "100% whc",
    "100whc",
    "whc100",
    "whc",
  ]);

  const missing: string[] = [];
  if (colName === -1) missing.push("Nome");
  if (colTransporterId === -1) missing.push("TransporterID");
  if (colScore === -1) missing.push("Score");
  if (colDelivered === -1) missing.push("PacotesEntregues");
  if (colDcr === -1) missing.push("DCR");
  if (colInsucessos === -1) missing.push("Insucessos");
  if (colDnr === -1) missing.push("DNR");
  if (colContact === -1) missing.push("ContactCompliance");
  if (colSwipe === -1) missing.push("SwipeToFinishCompliance");
  if (colWhc === -1) missing.push("100%WHC");

  return {
    columns: {
      name: colName,
      transporterId: colTransporterId,
      score: colScore,
      delivered: colDelivered,
      dcr: colDcr,
      insucessos: colInsucessos,
      dnr: colDnr,
      contactCompliance: colContact,
      swipeToFinishCompliance: colSwipe,
      whc100: colWhc,
    },
    missing,
  };
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

  const headers = normalizeHeaders(splitCsvLine(lines[0], delimiter));
  const { columns, missing } = detectColumns(headers);

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

  const rows: PerformanceRow[] = [];
  const errors: PerformanceParseError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const cells = splitCsvLine(lines[i], delimiter).map((c) =>
      c.trim() === "" ? undefined : c,
    );

    const result = parseRow(cells, lineNumber, columns);
    if (result.error) {
      errors.push(result.error);
    } else if (result.row) {
      rows.push(result.row);
    }
  }

  return { rows, errors };
}

export function parsePerformanceXlsx(fileBuffer: ArrayBuffer): PerformanceParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(fileBuffer), { type: "array" });
  } catch {
    return { rows: [], errors: [{ row: 0, reason: "Arquivo XLSX inválido." }] };
  }

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
  });

  if (rawData.length === 0) {
    return { rows: [], errors: [{ row: 0, reason: "Planilha XLSX vazia." }] };
  }

  const headers = normalizeHeaders(rawData[0]);
  const { columns, missing } = detectColumns(headers);

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

  const rows: PerformanceRow[] = [];
  const errors: PerformanceParseError[] = [];

  for (let i = 1; i < rawData.length; i++) {
    const lineNumber = i + 1;
    const cells = (rawData[i] ?? []) as unknown[];

    const result = parseRow(cells, lineNumber, columns);
    if (result.error) {
      errors.push(result.error);
    } else if (result.row) {
      rows.push(result.row);
    }
  }

  return { rows, errors };
}

export function parsePerformanceFile(
  fileBuffer: ArrayBuffer,
  fileName: string,
): PerformanceParseResult {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return parsePerformanceXlsx(fileBuffer);
  }
  return parsePerformanceCsv(fileBuffer);
}
