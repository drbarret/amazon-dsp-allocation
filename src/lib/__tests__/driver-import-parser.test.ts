import { describe, it, expect } from "vitest";
import {
  maskEmail,
  maskPhone,
  normalizeName,
  normalizeEmail,
  excelSerialToDate,
  formatPhone,
  validateEmail,
  validateStatus,
  parseRow,
} from "@/lib/driver-import-parser";

// ---------------------------------------------------------------------------
// maskEmail
// ---------------------------------------------------------------------------

describe("maskEmail", () => {
  it("masks a standard gmail address", () => {
    expect(maskEmail("ademirrosik@gmail.com")).toBe("ade***@gmail.com");
  });

  it("masks a short local part (2 chars)", () => {
    expect(maskEmail("ab@gmail.com")).toBe("ab***@gmail.com");
  });

  it("handles email without @", () => {
    expect(maskEmail("noat")).toBe("***");
  });

  it("handles empty string", () => {
    expect(maskEmail("")).toBe("***");
  });
});

// ---------------------------------------------------------------------------
// maskPhone
// ---------------------------------------------------------------------------

describe("maskPhone", () => {
  it("masks an 11-digit phone number", () => {
    expect(maskPhone(11945412952)).toBe("(11) ****-2952");
  });

  it("masks a phone string", () => {
    expect(maskPhone("11945412952")).toBe("(11) ****-2952");
  });

  it("handles short number", () => {
    expect(maskPhone("123")).toBe("***");
  });
});

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------

describe("normalizeName", () => {
  it("collapses double spaces", () => {
    expect(normalizeName("Ademir  Rosik")).toBe("Ademir Rosik");
  });

  it("collapses triple spaces", () => {
    expect(normalizeName("Adriana  Borges  Soares")).toBe("Adriana Borges Soares");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeName("  João Silva  ")).toBe("João Silva");
  });

  it("preserves single spaces", () => {
    expect(normalizeName("João Silva")).toBe("João Silva");
  });
});

// ---------------------------------------------------------------------------
// normalizeEmail
// ---------------------------------------------------------------------------

describe("normalizeEmail", () => {
  it("lowercases email", () => {
    expect(normalizeEmail("User@Gmail.Com")).toBe("user@gmail.com");
  });

  it("trims whitespace", () => {
    expect(normalizeEmail("  user@gmail.com  ")).toBe("user@gmail.com");
  });
});

// ---------------------------------------------------------------------------
// excelSerialToDate
// ---------------------------------------------------------------------------

describe("excelSerialToDate", () => {
  it("converts serial 47794 to 2030-11-07", () => {
    expect(excelSerialToDate(47794)).toBe("2030-11-07");
  });

  it("converts serial 48423 to 2032-07-28", () => {
    expect(excelSerialToDate(48423)).toBe("2032-07-28");
  });

  it("returns null for serial 0", () => {
    expect(excelSerialToDate(0)).toBeNull();
  });

  it("returns null for negative serial", () => {
    expect(excelSerialToDate(-1)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(excelSerialToDate(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(excelSerialToDate(null)).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(excelSerialToDate("not a number")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatPhone
// ---------------------------------------------------------------------------

describe("formatPhone", () => {
  it("formats 11-digit number to E.164", () => {
    expect(formatPhone(11945412952)).toBe("+5511945412952");
  });

  it("formats 11-digit string to E.164", () => {
    expect(formatPhone("11945412952")).toBe("+5511945412952");
  });

  it("formats 13-digit number with 55 prefix", () => {
    expect(formatPhone(5511945412952)).toBe("+5511945412952");
  });

  it("returns null for empty input", () => {
    expect(formatPhone("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(formatPhone(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(formatPhone(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateEmail
// ---------------------------------------------------------------------------

describe("validateEmail", () => {
  it("returns null for valid email", () => {
    expect(validateEmail("user@gmail.com")).toBeNull();
  });

  it("returns error for email without @", () => {
    expect(validateEmail("usergmail.com")).toBe("E-mail sem @");
  });

  it("returns error for empty email", () => {
    expect(validateEmail("")).toBe("E-mail vazio");
  });

  it("returns error for email without local part", () => {
    expect(validateEmail("@gmail.com")).toBe("E-mail sem parte local");
  });

  it("returns error for email without domain dot", () => {
    expect(validateEmail("user@gmail")).toBe("E-mail sem domínio válido");
  });

  it("trims and lowercases before validation", () => {
    expect(validateEmail("  User@Gmail.Com  ")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateStatus
// ---------------------------------------------------------------------------

describe("validateStatus", () => {
  it("returns ACTIVE for 'ACTIVE'", () => {
    expect(validateStatus("ACTIVE")).toBe("ACTIVE");
  });

  it("returns INACTIVE for 'INACTIVE'", () => {
    expect(validateStatus("INACTIVE")).toBe("INACTIVE");
  });

  it("returns ACTIVE for lowercase 'active'", () => {
    expect(validateStatus("active")).toBe("ACTIVE");
  });

  it("returns null for 'BLOQUEADO'", () => {
    expect(validateStatus("BLOQUEADO")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateStatus("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(validateStatus(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(validateStatus(null)).toBeNull();
  });

  it("returns null for random text", () => {
    expect(validateStatus("PENDING")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseRow — valid rows
// ---------------------------------------------------------------------------

describe("parseRow", () => {
  it("parses a valid ACTIVE row", () => {
    const row = [
      "Ademir  Rosik",
      "A1OFXDW2LCGDD5",
      "Driver",
      47794,
      11945412952,
      "ademirrosik@gmail.com",
      "ACTIVE",
    ];
    const result = parseRow(row, 2, new Set());
    if ("reason" in result) {
      throw new Error(`Expected driver, got error: ${result.reason}`);
    }
    expect(result.name).toBe("Ademir Rosik");
    expect(result.email).toBe("ademirrosik@gmail.com");
    expect(result.transporterId).toBe("A1OFXDW2LCGDD5");
    expect(result.cnhExpiration).toBe("2030-11-07");
    expect(result.phone).toBe("11945412952");
    expect(result.phoneFormatted).toBe("+5511945412952");
    expect(result.status).toBe("ACTIVE");
  });

  it("parses a valid INACTIVE row", () => {
    const row = [
      "Adriana  Borges  Soares",
      "A1R6Z3AQINJ8P3",
      "Driver",
      48423,
      11999448646,
      "alevictorsoares@gmail.com",
      "INACTIVE",
    ];
    const result = parseRow(row, 3, new Set());
    if ("reason" in result) {
      throw new Error(`Expected driver, got error: ${result.reason}`);
    }
    expect(result.name).toBe("Adriana Borges Soares");
    expect(result.status).toBe("INACTIVE");
  });

  // -----------------------------------------------------------------------
  // parseRow — error cases
  // -----------------------------------------------------------------------

  it("rejects row with empty name", () => {
    const row = ["", "A1", "Driver", 47794, 11945412952, "a@b.com", "ACTIVE"];
    const result = parseRow(row, 2, new Set());
    if (!("reason" in result)) {
      throw new Error("Expected error, got driver");
    }
    expect(result.reason).toBe("Nome vazio");
  });

  it("rejects row with malformed email (no @)", () => {
    const row = ["Nome", "A1", "Driver", 47794, 11945412952, "bademail", "ACTIVE"];
    const result = parseRow(row, 2, new Set());
    if (!("reason" in result)) {
      throw new Error("Expected error, got driver");
    }
    expect(result.reason).toBe("E-mail sem @");
  });

  it("rejects row with empty email", () => {
    const row = ["Nome", "A1", "Driver", 47794, 11945412952, "", "ACTIVE"];
    const result = parseRow(row, 2, new Set());
    if (!("reason" in result)) {
      throw new Error("Expected error, got driver");
    }
    expect(result.reason).toBe("E-mail vazio");
  });

  it("rejects row with unknown status", () => {
    const row = ["Nome", "A1", "Driver", 47794, 11945412952, "a@b.com", "BLOQUEADO"];
    const result = parseRow(row, 2, new Set());
    if (!("reason" in result)) {
      throw new Error("Expected error, got driver");
    }
    expect(result.reason).toContain("Status desconhecido");
  });

  it("rejects row with unexpected position", () => {
    const row = ["Nome", "A1", "Manager", 47794, 11945412952, "a@b.com", "ACTIVE"];
    const result = parseRow(row, 2, new Set());
    if (!("reason" in result)) {
      throw new Error("Expected error, got driver");
    }
    expect(result.reason).toContain("Position inesperada");
  });

  it("rejects duplicate email within batch", () => {
    const seenEmails = new Set<string>();
    seenEmails.add("duplicate@gmail.com");

    const row = ["Nome", "A1", "Driver", 47794, 11945412952, "duplicate@gmail.com", "ACTIVE"];
    const result = parseRow(row, 2, seenEmails);
    if (!("reason" in result)) {
      throw new Error("Expected error, got driver");
    }
    expect(result.reason).toContain("E-mail duplicado");
  });
});
