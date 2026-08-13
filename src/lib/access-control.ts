import { prisma } from "@/lib/prisma";

/**
 * Allowed corporate domains. Configure via ALLOWED_DOMAINS env var
 * as a comma-separated list (e.g. "instalog.com.br,amazon.com.br").
 * Falls back to the hardcoded default if the env var is not set.
 */
function getAllowedDomains(): string[] {
  const env = process.env.ALLOWED_DOMAINS;
  if (env) {
    return env
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }
  return ["instalog.com.br"];
}

/**
 * Check whether an email is on an allowed corporate domain.
 */
export function isCorporateDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return getAllowedDomains().includes(domain);
}

/**
 * Check whether an email is pre-registered (allowed to sign in).
 * Returns the AllowedEmail row if found and ACTIVE, null otherwise.
 */
export async function isPreRegistered(email: string) {
  const normalized = email.toLowerCase().trim();
  const record = await prisma.allowedEmail.findUnique({
    where: { email: normalized },
  });
  if (!record || record.status !== "ACTIVE") return null;
  return record;
}

/**
 * Pure authorization decision for sign-in.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 *
 * Rules (hybrid model):
 * 1. Corporate domain emails → auto-approved
 * 2. Pre-registered emails (AllowedEmail with status ACTIVE) → approved
 * 3. Everyone else → refused
 */
export async function authorizeSignIn(email: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: string }
> {
  const normalized = email.toLowerCase().trim();

  // Rule 1: corporate domain
  if (isCorporateDomain(normalized)) {
    return { allowed: true };
  }

  // Rule 2: pre-registered
  const preReg = await isPreRegistered(normalized);
  if (preReg) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "EMAIL_NOT_AUTHORIZED",
  };
}
