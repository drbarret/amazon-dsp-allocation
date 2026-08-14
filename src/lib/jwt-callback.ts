import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/generated/prisma";

export const ROLE_FRESHNESS_MS = 15_000; // 15 seconds

export async function jwtCallback({ token, user, account }: {
  token: Record<string, unknown>;
  user?: { id?: string };
  account?: { provider?: string } | null;
}) {
  if (user) {
    token.id = user.id;
  }

  // On first sign-in, read role from DB and apply pre-registered role if needed
  if (account?.provider === "amazon" && token.email) {
    const dbUser = await prisma.user.findUnique({
      where: { email: token.email as string },
      select: { role: true, amazonSub: true, active: true },
    });
    if (dbUser) {
      if (dbUser.role === "DRIVER") {
        const allowedEmail = await prisma.allowedEmail.findUnique({
          where: { email: token.email as string },
          select: { role: true, status: true },
        });
        if (allowedEmail && allowedEmail.status === "ACTIVE" && allowedEmail.role !== "DRIVER") {
          await prisma.user.update({
            where: { email: token.email as string },
            data: { role: allowedEmail.role },
          });
          token.role = allowedEmail.role as UserRole;
        } else {
          token.role = dbUser.role as UserRole;
        }
      } else {
        token.role = dbUser.role as UserRole;
      }
      token.amazonSub = dbUser.amazonSub;
      token.active = dbUser.active;
      token.roleLastFetched = Date.now();
    }
  }

  // Re-read role from DB if freshness window expired
  const now = Date.now();
  const lastFetched = (token.roleLastFetched as number) ?? 0;
  if (token.email && now - lastFetched > ROLE_FRESHNESS_MS) {
    const dbUser = await prisma.user.findUnique({
      where: { email: token.email as string },
      select: { role: true, active: true },
    });
    if (dbUser) {
      token.role = dbUser.role as UserRole;
      token.active = dbUser.active;
      token.roleLastFetched = now;
    } else {
      // User row missing — fail closed
      token.active = false;
    }
  }

  return token;
}
