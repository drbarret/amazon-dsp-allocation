import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { UserManagementClient } from "./client";
import type { UserRole } from "@/generated/prisma";

export const dynamic = "force-dynamic";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  onboardingCompleted: boolean | null;
  lastLoginAt: string | null;
  source: "user" | "invite";
  allowedEmailId?: string;
  allowedEmailStatus?: string;
  cnhExpiration?: string | null;
  cityPreferences?: string[];
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  ACCOUNT_MANAGER: "Gerente de Contas",
  SUPERVISOR: "Supervisor",
  DRIVER: "Motorista",
};

export default async function AdminUsersPage() {
  const session = await requireRole("ACCOUNT_MANAGER");

  // Fetch real users
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      lastLoginAt: true,
      driverProfile: {
        select: {
          onboardingCompleted: true,
          cnhExpiration: true,
          regionPreferences: {
            select: { city: true, priority: true },
            orderBy: { priority: "asc" },
          },
        },
      },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  // Fetch pre-registered invites (AllowedEmail)
  const invites = await prisma.allowedEmail.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
    },
    orderBy: { email: "asc" },
  });

  // Build merged list: real users + invites without matching user
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));
  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    onboardingCompleted: u.driverProfile?.onboardingCompleted ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    source: "user" as const,
    cnhExpiration: u.driverProfile?.cnhExpiration?.toISOString() ?? null,
    cityPreferences: (u.driverProfile?.regionPreferences ?? [])
      .filter((p) => p.city)
      .map((p) => p.city as string),
  }));

  for (const invite of invites) {
    if (!userEmails.has(invite.email.toLowerCase())) {
      rows.push({
        id: invite.id,
        name: invite.email.split("@")[0],
        email: invite.email,
        role: invite.role,
        active: invite.status === "ACTIVE",
        onboardingCompleted: null,
        lastLoginAt: null,
        source: "invite" as const,
        allowedEmailId: invite.id,
        allowedEmailStatus: invite.status,
      });
    }
  }

  // Sort: ADMIN first, then ACCOUNT_MANAGER, SUPERVISOR, DRIVER, then by name
  const roleOrder: Record<string, number> = {
    ADMIN: 0,
    ACCOUNT_MANAGER: 1,
    SUPERVISOR: 2,
    DRIVER: 3,
  };
  rows.sort((a, b) => {
    const ra = roleOrder[a.role] ?? 4;
    const rb = roleOrder[b.role] ?? 4;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  return (
    <UserManagementClient
      users={rows}
      currentUserId={session.user.id}
      roleLabels={ROLE_LABELS}
    />
  );
}
