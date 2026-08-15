"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { roleIsAtLeast } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import type { UserRole } from "@/generated/prisma";

const ALLOWED_ROLES: UserRole[] = ["DRIVER", "SUPERVISOR", "ACCOUNT_MANAGER", "ADMIN"];

async function requireAdminOrAccountManager() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Não autenticado.");
  }
  if (!roleIsAtLeast(session.user.role as UserRole, "ACCOUNT_MANAGER")) {
    throw new Error("Permissão insuficiente.");
  }
  return session;
}

export async function changeUserRole(targetUserId: string, newRole: UserRole) {
  const session = await requireAdminOrAccountManager();
  const actorId = session.user.id;

  if (!ALLOWED_ROLES.includes(newRole)) {
    return { success: false, error: "Papel inválido." };
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, email: true },
  });
  if (!target) {
    return { success: false, error: "Usuário não encontrado." };
  }

  const oldRole = target.role;

  // Guardrail: cannot demote/deactivate yourself if you're the last active ADMIN
  if (targetUserId === actorId && oldRole === "ADMIN" && newRole !== "ADMIN") {
    const adminCount = await prisma.user.count({
      where: { role: "ADMIN", active: true },
    });
    if (adminCount <= 1) {
      return {
        success: false,
        error:
          "Não é possível alterar seu próprio papel de ADMIN. Deve haver pelo menos um ADMIN ativo no sistema.",
      };
    }
  }

  // Guardrail: if demoting an ADMIN, ensure at least one other active ADMIN remains
  if (oldRole === "ADMIN" && newRole !== "ADMIN") {
    const adminCount = await prisma.user.count({
      where: { role: "ADMIN", active: true },
    });
    if (adminCount <= 1) {
      return {
        success: false,
        error:
          "Não é possível remover o último ADMIN ativo. Promova outro usuário a ADMIN primeiro.",
      };
    }
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
  });

  await writeAuditLog({
    eventType: "ROLE_CHANGED",
    actorId,
    targetUserId,
    oldValue: { role: oldRole },
    newValue: { role: newRole },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

export async function deactivateUser(targetUserId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Não autenticado.");
  }
  const actorRole = session.user.role as UserRole;
  const actorId = session.user.id;

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, active: true, email: true },
  });
  if (!target) {
    return { success: false, error: "Usuário não encontrado." };
  }

  // Rule 9: who deactivates determines who can reactivate. A supervisor may
  // deactivate a DRIVER (e.g. for behavior recidivism); account managers and
  // admins may deactivate anyone. The deactivator is recorded so reactivation
  // can be restricted accordingly.
  if (!roleIsAtLeast(actorRole, "ACCOUNT_MANAGER")) {
    if (actorRole !== "SUPERVISOR" || target.role !== "DRIVER") {
      return { success: false, error: "Permissão insuficiente." };
    }
  }

  if (!target.active) {
    return { success: false, error: "Usuário já está desativado." };
  }

  // Guardrail: cannot deactivate the last active ADMIN
  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({
      where: { role: "ADMIN", active: true },
    });
    if (adminCount <= 1) {
      return {
        success: false,
        error:
          "Não é possível desativar o último ADMIN ativo. Promova outro usuário a ADMIN primeiro.",
      };
    }
  }

  // Guardrail: cannot deactivate yourself
  if (targetUserId === actorId) {
    return {
      success: false,
      error: "Você não pode desativar sua própria conta.",
    };
  }

  // Layer 2: deactivate User, recording who deactivated (for the reactivation rule)
  await prisma.user.update({
    where: { id: targetUserId },
    data: { active: false, deactivatedById: actorId, deactivatedByRole: actorRole },
  });

  // Layer 1: block AllowedEmail (set ACTIVE → BLOCKED)
  // Only touch it if it exists and is ACTIVE — don't overwrite REVOKED.
  await prisma.allowedEmail.updateMany({
    where: { email: target.email, status: "ACTIVE" },
    data: { status: "BLOCKED" },
  });

  await writeAuditLog({
    eventType: "USER_DEACTIVATED",
    actorId,
    targetUserId,
    oldValue: { active: true },
    newValue: { active: false, deactivatedByRole: actorRole },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

export async function reactivateUser(targetUserId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Não autenticado.");
  }
  const actorRole = session.user.role as UserRole;
  const actorId = session.user.id;

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, active: true, email: true, deactivatedByRole: true },
  });
  if (!target) {
    return { success: false, error: "Usuário não encontrado." };
  }

  if (target.active) {
    return { success: false, error: "Usuário já está ativo." };
  }

  // Rule 9: who deactivates determines who can reactivate.
  //   - If an account manager (or admin) deactivated, only an account manager
  //     (or admin) may reactivate — a supervisor cannot.
  //   - If a supervisor deactivated, a supervisor or account manager may reactivate.
  const deactivatedBy = target.deactivatedByRole;
  if (deactivatedBy === "ACCOUNT_MANAGER" || deactivatedBy === "ADMIN") {
    if (!roleIsAtLeast(actorRole, "ACCOUNT_MANAGER")) {
      return {
        success: false,
        error:
          "Este usuário foi desativado por um gerente de contas. Somente um gerente de contas ou administrador pode reativá-lo.",
      };
    }
  } else {
    // Supervisor deactivated (or unknown) — supervisor+ may reactivate.
    if (!roleIsAtLeast(actorRole, "SUPERVISOR")) {
      return { success: false, error: "Permissão insuficiente." };
    }
  }

  // Layer 2: reactivate User, clearing the deactivation record
  await prisma.user.update({
    where: { id: targetUserId },
    data: { active: true, deactivatedById: null, deactivatedByRole: null },
  });

  // Layer 1: reactivate AllowedEmail (set BLOCKED → ACTIVE)
  // Only touch it if it exists and is BLOCKED — don't overwrite REVOKED.
  await prisma.allowedEmail.updateMany({
    where: { email: target.email, status: "BLOCKED" },
    data: { status: "ACTIVE" },
  });

  await writeAuditLog({
    eventType: "USER_ACTIVATED",
    actorId,
    targetUserId,
    oldValue: { active: false },
    newValue: { active: true },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

export async function inviteUser(email: string, role: UserRole) {
  const session = await requireAdminOrAccountManager();
  const actorId = session.user.id;

  const normalized = email.toLowerCase().trim();
  if (!normalized.includes("@")) {
    return { success: false, error: "E-mail inválido." };
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return { success: false, error: "Papel inválido." };
  }

  const existing = await prisma.allowedEmail.findUnique({
    where: { email: normalized },
  });

  if (existing) {
    if (existing.status === "ACTIVE") {
      return { success: false, error: "Este e-mail já está convidado." };
    }
    // Reactivate a revoked entry
    await prisma.allowedEmail.update({
      where: { email: normalized },
      data: { status: "ACTIVE", role, invitedById: actorId },
    });
  } else {
    await prisma.allowedEmail.create({
      data: {
        email: normalized,
        role,
        invitedById: actorId,
        status: "ACTIVE",
      },
    });
  }

  await writeAuditLog({
    eventType: "USER_INVITED",
    actorId,
    metadata: { email: normalized, role },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

export async function revokeInvite(allowedEmailId: string) {
  const session = await requireAdminOrAccountManager();
  const actorId = session.user.id;

  const entry = await prisma.allowedEmail.findUnique({
    where: { id: allowedEmailId },
    select: { id: true, email: true, status: true },
  });
  if (!entry) {
    return { success: false, error: "Convite não encontrado." };
  }

  if (entry.status === "REVOKED") {
    return { success: false, error: "Convite já está revogado." };
  }

  await prisma.allowedEmail.update({
    where: { id: allowedEmailId },
    data: { status: "REVOKED" },
  });

  await writeAuditLog({
    eventType: "USER_INVITE_REVOKED",
    actorId,
    metadata: { email: entry.email, allowedEmailId },
  });

  revalidatePath("/admin/users");
  return { success: true };
}
