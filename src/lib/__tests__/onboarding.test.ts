import { describe, it, expect } from "vitest";
import { validateCpf, validatePhone } from "@/lib/onboarding";

// ---------------------------------------------------------------------------
// validateCpf — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe("validateCpf", () => {
  // Known valid CPFs (check digits verified)
  it("valid CPF 529.982.247-25", () => {
    const result = validateCpf("529.982.247-25");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("52998224725");
  });

  it("valid CPF unformatted 52998224725", () => {
    const result = validateCpf("52998224725");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("52998224725");
  });

  it("valid CPF 123.456.789-09", () => {
    const result = validateCpf("123.456.789-09");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("12345678909");
  });

  // Invalid check digits
  it("invalid check digit (last digit wrong)", () => {
    const result = validateCpf("529.982.247-26");
    expect(result.valid).toBe(false);
  });

  it("invalid check digit (first check digit wrong)", () => {
    const result = validateCpf("529.982.247-35");
    expect(result.valid).toBe(false);
  });

  it("invalid check digit (both wrong)", () => {
    const result = validateCpf("529.982.247-00");
    expect(result.valid).toBe(false);
  });

  // Repeated digits
  it("repeated digits 111.111.111-11", () => {
    const result = validateCpf("111.111.111-11");
    expect(result.valid).toBe(false);
  });

  it("repeated digits 000.000.000-00", () => {
    const result = validateCpf("000.000.000-00");
    expect(result.valid).toBe(false);
  });

  it("repeated digits 999.999.999-99", () => {
    const result = validateCpf("999.999.999-99");
    expect(result.valid).toBe(false);
  });

  // Wrong length
  it("too short (10 digits)", () => {
    const result = validateCpf("529.982.247-2");
    expect(result.valid).toBe(false);
    expect(result.normalized).toBe("5299822472");
  });

  it("too long (12 digits)", () => {
    const result = validateCpf("529.982.247-255");
    expect(result.valid).toBe(false);
    expect(result.normalized).toBe("529982247255");
  });

  it("empty string", () => {
    const result = validateCpf("");
    expect(result.valid).toBe(false);
    expect(result.normalized).toBe("");
  });

  // Formatted vs unformatted
  it("formatted and unformatted give same normalized result", () => {
    const r1 = validateCpf("529.982.247-25");
    const r2 = validateCpf("52998224725");
    expect(r1.normalized).toBe(r2.normalized);
    expect(r1.valid).toBe(r2.valid);
  });
});

// ---------------------------------------------------------------------------
// validatePhone — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe("validatePhone", () => {
  it("valid mobile (XX) XXXXX-XXXX", () => {
    const result = validatePhone("(11) 98765-4321");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("11987654321");
  });

  it("valid landline (XX) XXXX-XXXX", () => {
    const result = validatePhone("(11) 3456-7890");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("1134567890");
  });

  it("valid with country code +55 mobile", () => {
    const result = validatePhone("+55 (11) 98765-4321");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("5511987654321");
  });

  it("valid with country code +55 landline", () => {
    const result = validatePhone("+55 (11) 3456-7890");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("551134567890");
  });

  it("valid unformatted 11-digit mobile", () => {
    const result = validatePhone("11987654321");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("11987654321");
  });

  it("valid unformatted 10-digit landline", () => {
    const result = validatePhone("1134567890");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("1134567890");
  });

  it("invalid: too short", () => {
    const result = validatePhone("12345");
    expect(result.valid).toBe(false);
  });

  it("invalid: too long (14 digits)", () => {
    const result = validatePhone("12345678901234");
    expect(result.valid).toBe(false);
  });

  it("invalid: 9 digits (not matching any format)", () => {
    const result = validatePhone("123456789");
    expect(result.valid).toBe(false);
  });

  it("invalid: empty string", () => {
    const result = validatePhone("");
    expect(result.valid).toBe(false);
    expect(result.normalized).toBe("");
  });
});
