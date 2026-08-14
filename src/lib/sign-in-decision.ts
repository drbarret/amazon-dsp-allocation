import { prisma } from "@/lib/prisma";
import { authorizeSignIn } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";

/**
 * Pure sign-in authorization decision, extracted from auth.ts signIn callback.
 *
 * This is the EXACT same logic used in production. The auth.ts signIn callback
 * calls this function. Tests that call signInDecision are testing the real
 * production code, not a reimplementation.
 *
 * Returns { allowed: true } or { allowed: false, reason: string }.
 * Also writes audit log entries as a side effect (same as auth.ts).
 */
export async function signInDecision(params: {
  email: string;
  providerAccountId: string;
}): Promise<
  | { allowed: true }
  | { allowed: false; reason: string }
> {
  const { email, providerAccountId } = params;

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    // Update amazon sub and last login
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        amazonSub: providerAccountId,
        lastLoginAt: new Date(),
      },
    });

    // Refuse deactivated users
    if (!existingUser.active) {
      await writeAuditLog({
        eventType: "ACCESS_DENIED",
        targetUserId: existingUser.id,
        metadata: { reason: "user_deactivated", email },
      });
      return { allowed: false, reason: "user_deactivated" };
    }

    // Log successful login
    await writeAuditLog({
      eventType: "LOGIN",
      actorId: existingUser.id,
    });

    return { allowed: true };
  }

  // New user: check access control
  const authz = await authorizeSignIn(email);
  if (!authz.allowed) {
    await writeAuditLog({
      eventType: "ACCESS_DENIED",
      metadata: { reason: authz.reason, email },
    });
    return { allowed: false, reason: authz.reason };
  }

  return { allowed: true };
}
