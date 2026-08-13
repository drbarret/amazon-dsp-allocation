import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM

function getEncryptionKey(): Buffer {
  const key = process.env.FIELD_ENCRYPTION_KEY;
  if (!key) throw new Error("FIELD_ENCRYPTION_KEY is not set");
  // Support hex-encoded keys (64 hex chars = 32 bytes)
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  // Fallback: hash the provided key to get 32 bytes
  return createHmac("sha256", "field-encryption-v1").update(key).digest();
}

function getBlindIndexKey(): Buffer {
  const key = process.env.FIELD_BLIND_INDEX_KEY;
  if (!key) throw new Error("FIELD_BLIND_INDEX_KEY is not set");
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  return createHmac("sha256", "blind-index-v1").update(key).digest();
}

/**
 * Encrypt a plaintext value using AES-256-GCM.
 * Returns "iv:authTag:ciphertext" all hex-encoded.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value produced by encrypt().
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/**
 * Compute a deterministic blind index for a normalized CPF.
 * Uses HMAC-SHA256 with a separate key so the index cannot be reversed
 * to recover the CPF, but identical CPFs produce identical indices.
 */
export function computeCpfBlindIndex(cpf: string): string {
  const key = getBlindIndexKey();
  const normalized = cpf.replace(/\D/g, "");
  return createHmac("sha256", key).update(normalized).digest("hex");
}
