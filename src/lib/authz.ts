import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { UserRole } from "@/generated/prisma";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  ADMIN: 4,
  ACCOUNT_MANAGER: 3,
  SUPERVISOR: 2,
  DRIVER: 1,
};

/**
 * Require an authenticated session. Redirects to /login if not signed in.
 * Also refuses deactivated users (active === false).
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  // Deactivated users are refused everywhere
  if ((session.user as { active?: boolean }).active === false) {
    redirect("/login?error=deactivated");
  }
  return session;
}

/**
 * Require a minimum role. Redirects to /forbidden if the user's role
 * is below the threshold. Also enforces requireAuth() checks.
 */
export async function requireRole(minRole: UserRole) {
  const session = await requireAuth();
  const userRole = session.user.role as UserRole | undefined;
  const requiredLevel = ROLE_HIERARCHY[minRole];
  const userLevel = userRole ? ROLE_HIERARCHY[userRole] : 0;

  if (!userRole || userLevel < requiredLevel) {
    redirect("/forbidden");
  }

  return session;
}

/**
 * Check if a role meets or exceeds a minimum role level.
 * Pure function, usable in any context (including signIn callback).
 */
export function roleIsAtLeast(userRole: UserRole | undefined, minRole: UserRole): boolean {
  if (!userRole) return false;
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0);
}
