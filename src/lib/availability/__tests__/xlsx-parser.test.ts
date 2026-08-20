import { describe, it, expect, vi } from "vitest";
import XLSX from "xlsx";

vi.mock("server-only", () => ({}));

import {
  parseXlsxAvailability,
  normalizeEmail,
  validateEmail,
  parseYesNo,
  cleanCpf,
  parseDateTime,
} from "@/lib/availability/xlsx-parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildXlsx(rows: unknown[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const HEADERS = [
  "Carimbo de data/hora",
  "Endereço de e-mail",
  "Nome completo",
  "CPF",
  "GNV?",
  "Passeio?",
  "Dom",
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sáb",
  "Speed?",
];

function dataRow(overrides: Partial<Record<number, string>> = {}): unknown[] {
  const base: unknown[] = [
    "18/08/2026 14:30:00",
    "ativo@example.com",
    "Motorista Ativo",
    "123.456.789-09",
    "Sim",
    "Não",
    "Sim",
    "Sim",
    "Sim",
    "Sim",
    "Sim",
    "Sim",
    "Não",
    "Sim",
  ];
  Object.entries(overrides).forEach(([idx, value]) => {
    base[Number(idx)] = value;
  });
  return base;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("handles undefined", () => {
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("validateEmail", () => {
  it("returns null for valid email", () => {
    expect(validateEmail("user@example.com")).toBeNull();
  });

  it("returns error for empty email", () => {
    expect(validateEmail("")).toBe("E-mail ausente");
  });

  it("returns error for missing @", () => {
    expect(validateEmail("userexample.com")).toContain("inválido");
  });

  it("returns error for missing domain dot", () => {
    expect(validateEmail("user@example")).toContain("inválido");
  });
});

describe("parseYesNo", () => {
  it("returns true for Sim", () => {
    expect(parseYesNo("Sim")).toBe(true);
    expect(parseYesNo("  sim  ")).toBe(true);
    expect(parseYesNo("SIM")).toBe(true);
  });

  it("returns false for anything else", () => {
    expect(parseYesNo("Não")).toBe(false);
    expect(parseYesNo("")).toBe(false);
    expect(parseYesNo(undefined)).toBe(false);
  });
});

describe("cleanCpf", () => {
  it("removes punctuation", () => {
    expect(cleanCpf("123.456.789-09")).toBe("12345678909");
  });

  it("returns null for empty", () => {
    expect(cleanCpf("")).toBeNull();
  });
});

describe("parseDateTime", () => {
  it("parses dd/MM/yyyy HH:mm:ss", () => {
    const d = parseDateTime("18/08/2026 14:30:00");
    expect(d).not.toBeNull();
    expect(d?.toISOString()).toBe("2026-08-18T17:30:00.000Z");
  });

  it("parses dd/MM/yyyy H:mm:ss", () => {
    const d = parseDateTime("18/08/2026 9:05:00");
    expect(d).not.toBeNull();
    expect(d?.getHours()).toBe(9);
    expect(d?.getMinutes()).toBe(5);
  });

  it("returns null for invalid", () => {
    expect(parseDateTime("not a date")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseXlsxAvailability
// ---------------------------------------------------------------------------

describe("parseXlsxAvailability", () => {
  const mockFindUsers = vi.fn();

  it("classifies active driver", async () => {
    mockFindUsers.mockResolvedValue([
      { id: "user-active", email: "ativo@example.com", role: "DRIVER", active: true },
    ]);

    const file = buildXlsx([HEADERS, dataRow()]);
    const result = await parseXlsxAvailability(file, "W35", {
      findUsersByEmails: mockFindUsers,
    });

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.availabilities).toHaveLength(1);

    const record = result.availabilities[0];
    expect(record.email).toBe("ativo@example.com");
    expect(record.userId).toBe("user-active");
    expect(record.hasNaturalGas).toBe(true);
    expect(record.isPassengerCar).toBe(false);
    expect(record.sunAvailable).toBe(true);
    expect(record.satAvailable).toBe(false);
    expect(record.speedAfternoon).toBe(true);
    expect(record.cpf).toBe("12345678909");

    expect(result.summary).toEqual({
      week: "W35",
      totalRows: 1,
      active: 1,
      inactive: 0,
      invalid: 0,
    });
  });

  it("classifies inactive driver when user exists but is not active", async () => {
    mockFindUsers.mockResolvedValue([
      { id: "user-inactive", email: "inativo@example.com", role: "DRIVER", active: false },
    ]);

    const file = buildXlsx([
      HEADERS,
      dataRow({ 1: "inativo@example.com", 2: "Motorista Inativo" }),
    ]);
    const result = await parseXlsxAvailability(file, "W35", {
      findUsersByEmails: mockFindUsers,
    });

    expect(result.availabilities).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      row: 2,
      email: "inativo@example.com",
      name: "Motorista Inativo",
    });
    expect(result.warnings[0].reason).toContain("não está ativo");
    expect(result.summary.inactive).toBe(1);
  });

  it("classifies inactive driver when user is not found", async () => {
    mockFindUsers.mockResolvedValue([]);

    const file = buildXlsx([
      HEADERS,
      dataRow({ 1: "nao.cadastrado@example.com", 2: "Desconhecido" }),
    ]);
    const result = await parseXlsxAvailability(file, "W35", {
      findUsersByEmails: mockFindUsers,
    });

    expect(result.availabilities).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toContain("não encontrado");
    expect(result.summary.inactive).toBe(1);
  });

  it("classifies invalid row when email is missing", async () => {
    mockFindUsers.mockResolvedValue([]);

    const file = buildXlsx([HEADERS, dataRow({ 1: "" })]);
    const result = await parseXlsxAvailability(file, "W35", {
      findUsersByEmails: mockFindUsers,
    });

    expect(result.availabilities).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      row: 2,
      reason: "E-mail ausente",
    });
    expect(result.summary.invalid).toBe(1);
  });

  it("classifies invalid row when email is malformed", async () => {
    mockFindUsers.mockResolvedValue([]);

    const file = buildXlsx([HEADERS, dataRow({ 1: "not-an-email" })]);
    const result = await parseXlsxAvailability(file, "W35", {
      findUsersByEmails: mockFindUsers,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toContain("inválido");
  });

  it("throws when week is empty", async () => {
    await expect(parseXlsxAvailability(buildXlsx([HEADERS]), "")).rejects.toThrow(
      "Semana não informada"
    );
  });

  it("throws when header has fewer than 14 columns", async () => {
    const file = buildXlsx([
      ["A", "B", "C"],
      ["", "", ""],
    ]);
    await expect(parseXlsxAvailability(file, "W35")).rejects.toThrow(
      "Cabeçalho incompleto"
    );
  });

  it("skips empty rows", async () => {
    mockFindUsers.mockResolvedValue([
      { id: "user-active", email: "ativo@example.com", role: "DRIVER", active: true },
    ]);

    const file = buildXlsx([HEADERS, ["", "", "", "", "", "", "", "", "", "", "", "", "", ""], dataRow()]);
    const result = await parseXlsxAvailability(file, "W35", {
      findUsersByEmails: mockFindUsers,
    });

    expect(result.summary.totalRows).toBe(1);
    expect(result.availabilities).toHaveLength(1);
  });
});
