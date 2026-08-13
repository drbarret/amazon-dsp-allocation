import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// Set encryption keys before importing the module
beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.FIELD_BLIND_INDEX_KEY = randomBytes(32).toString("hex");
});

// Dynamic import so env vars are set before module init
const { encrypt, decrypt, computeCpfBlindIndex } = await import("@/lib/crypto");

describe("encrypt / decrypt", () => {
  it("round-trips a plaintext value", () => {
    const plaintext = "52998224725";
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("round-trips a short string", () => {
    const plaintext = "abc";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe("abc");
  });

  it("round-trips an empty string", () => {
    const plaintext = "";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe("");
  });

  it("ciphertext differs from plaintext", () => {
    const plaintext = "52998224725";
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it("two encryptions of the same value differ (random IV)", () => {
    const plaintext = "52998224725";
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
  });

  it("ciphertext has expected format (iv:authTag:ciphertext)", () => {
    const ciphertext = encrypt("test");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    // IV is 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext should be non-empty hex
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it("throws on invalid ciphertext format", () => {
    expect(() => decrypt("not-valid")).toThrow("Invalid ciphertext format");
  });

  it("throws on tampered ciphertext", () => {
    const ciphertext = encrypt("test");
    // Tamper with the auth tag
    const parts = ciphertext.split(":");
    parts[1] = "00".repeat(16);
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});

describe("computeCpfBlindIndex", () => {
  it("is deterministic for the same input", () => {
    const cpf = "52998224725";
    expect(computeCpfBlindIndex(cpf)).toBe(computeCpfBlindIndex(cpf));
  });

  it("differs for different inputs", () => {
    const idx1 = computeCpfBlindIndex("52998224725");
    const idx2 = computeCpfBlindIndex("12345678909");
    expect(idx1).not.toBe(idx2);
  });

  it("strips formatting before hashing", () => {
    const formatted = "529.982.247-25";
    const unformatted = "52998224725";
    expect(computeCpfBlindIndex(formatted)).toBe(computeCpfBlindIndex(unformatted));
  });

  it("produces a 64-char hex string", () => {
    const idx = computeCpfBlindIndex("52998224725");
    expect(idx).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(idx)).toBe(true);
  });
});
