import { prisma } from "@/lib/prisma";

/**
 * Check whether an email is pre-registered (allowed to sign in).
 * Returns the AllowedEmail row if found and ACTIVE, null otherwise.
 *
 * This is the ONLY authorization gate for sign-in. There is no
 * corporate-domain auto-approve — every identity must be explicitly
 * pre-registered in the AllowedEmail table with status ACTIVE.
 *
 * Statuses:
 *   ACTIVE  — allowed to sign in
 *   REVOKED — invite explicitly withdrawn (permanent denial)
 *   BLOCKED — user is deactivated (temporary, reversible via reactivation)
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
 * Rule (closed access list):
 * 1. Pre-registered emails (AllowedEmail with status ACTIVE) → approved
 * 2. Everyone else → refused
 */
export async function authorizeSignIn(email: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: string }
> {
  const normalized = email.toLowerCase().trim();

  const preReg = await isPreRegistered(normalized);
  if (preReg) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "EMAIL_NOT_AUTHORIZED",
  };
}
