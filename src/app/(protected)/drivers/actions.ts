"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { roleIsAtLeast } from "@/lib/authz";
import { encrypt } from "@/lib/crypto";
import { validateCityPreferences } from "@/lib/onboarding";
import { revalidatePath } from "next/cache";
import type { UserRole, VehicleType } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANAGEMENT_ROLES: UserRole[] = ["ADMIN", "ACCOUNT_MANAGER"];

async function requireSupervisorOrAbove() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Não autenticado.");
  }
  if (!roleIsAtLeast(session.user.role as UserRole, "SUPERVISOR")) {
    throw new Error("Permissão insuficiente.");
  }
  return session;
}

export async function resolveTransportCompanyId(
  actorId: string,
  actorRole: UserRole,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { transportCompanyId: true },
  });

  const ownTransportCompanyId = user?.transportCompanyId ?? null;

  if (ownTransportCompanyId) {
    return { ok: true, id: ownTransportCompanyId };
  }

  if (!MANAGEMENT_ROLES.includes(actorRole)) {
    return { ok: false, error: "Usuário não vinculado a uma transportadora." };
  }

  // ADMIN / ACCOUNT_MANAGER without company can access any
  return { ok: true, id: null };
}

function checkCrossCompany(
  actorCompanyId: string | null,
  targetCompanyId: string | null,
): { ok: true } | { ok: false; error: string } {
  if (actorCompanyId && targetCompanyId && actorCompanyId !== targetCompanyId) {
    return { ok: false, error: "Sem permissão para editar motoristas de outra transportadora." };
  }
  return { ok: true };
}

const VALID_VEHICLE_TYPES: VehicleType[] = ["CARGO_VAN", "LARGE_VAN", "PASSEIO"];

// ---------------------------------------------------------------------------
// saveDriverEdits — single transactional action for the edit modal
// ---------------------------------------------------------------------------

export interface SaveDriverEditsInput {
  name?: string;
  vehicleType?: string;
  transporterId?: string;
  worksCiclo1?: boolean;
  worksCiclo2?: boolean;
  isTrusted?: boolean;
  whatsappGroup?: string;
  phone?: string;
  cities?: string[];
}

export async function saveDriverEdits(
  targetUserId: string,
  data: SaveDriverEditsInput,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireSupervisorOrAbove();
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  if (targetUserId === actorId) {
    return { success: false, error: "Você não pode editar seu próprio perfil nesta tela." };
  }

  // Resolve actor's company for cross-company check
  const access = await resolveTransportCompanyId(actorId, actorRole);
  if (!access.ok) {
    return { success: false, error: access.error };
  }

  // Fetch target with current values for audit + cross-company
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      transportCompanyId: true,
      driverProfile: {
        select: {
          id: true,
          vehicleType: true,
          transporterId: true,
          worksCiclo1: true,
          worksCiclo2: true,
          isTrusted: true,
          whatsappGroup: true,
          phoneFormatted: true,
          regionPreferences: {
            select: { city: true, priority: true },
            orderBy: { priority: "asc" },
          },
        },
      },
    },
  });

  if (!target || target.role !== "DRIVER" || !target.driverProfile) {
    return { success: false, error: "Motorista não encontrado." };
  }

  const crossCheck = checkCrossCompany(access.id, target.transportCompanyId);
  if (!crossCheck.ok) {
    return { success: false, error: crossCheck.error };
  }

  // --- Validations ---

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed || trimmed.length > 200) {
      return { success: false, error: "Nome deve ter entre 1 e 200 caracteres." };
    }
  }

  if (data.vehicleType !== undefined) {
    if (!(VALID_VEHICLE_TYPES as string[]).includes(data.vehicleType)) {
      return { success: false, error: "Tipo de veículo inválido." };
    }
  }

  if (data.whatsappGroup !== undefined) {
    if (data.whatsappGroup.length > 80) {
      return { success: false, error: "Grupo de WhatsApp deve ter no máximo 80 caracteres." };
    }
  }

  if (data.cities !== undefined) {
    const cityValidation = validateCityPreferences(data.cities);
    if (!cityValidation.valid) {
      return { success: false, error: cityValidation.error! };
    }
  }

  // --- Build old/new values for audit ---
  const profile = target.driverProfile;
  const oldValue: Record<string, string | boolean | null | string[]> = {};
  const newValue: Record<string, string | boolean | null | string[]> = {};

  if (data.name !== undefined && data.name.trim() !== target.name) {
    oldValue.name = target.name;
    newValue.name = data.name.trim();
  }
  if (data.vehicleType !== undefined && data.vehicleType !== profile.vehicleType) {
    oldValue.vehicleType = profile.vehicleType;
    newValue.vehicleType = data.vehicleType;
  }
  if (data.transporterId !== undefined && data.transporterId !== profile.transporterId) {
    oldValue.transporterId = profile.transporterId;
    newValue.transporterId = data.transporterId;
  }
  if (data.worksCiclo1 !== undefined && data.worksCiclo1 !== profile.worksCiclo1) {
    oldValue.worksCiclo1 = profile.worksCiclo1;
    newValue.worksCiclo1 = data.worksCiclo1;
  }
  if (data.worksCiclo2 !== undefined && data.worksCiclo2 !== profile.worksCiclo2) {
    oldValue.worksCiclo2 = profile.worksCiclo2;
    newValue.worksCiclo2 = data.worksCiclo2;
  }
  if (data.isTrusted !== undefined && data.isTrusted !== profile.isTrusted) {
    oldValue.isTrusted = profile.isTrusted;
    newValue.isTrusted = data.isTrusted;
  }
  if (data.whatsappGroup !== undefined && data.whatsappGroup !== profile.whatsappGroup) {
    oldValue.whatsappGroup = profile.whatsappGroup;
    newValue.whatsappGroup = data.whatsappGroup;
  }
  if (data.phone !== undefined) {
    oldValue.phone = "(oculto)";
    newValue.phone = "(atualizado)";
  }
  if (data.cities !== undefined) {
    oldValue.cities = profile.regionPreferences.filter((p) => p.city).map((p) => p.city as string);
    newValue.cities = data.cities;
  }

  // Nothing to update?
  if (Object.keys(newValue).length === 0) {
    return { success: true }; // no-op
  }

  // --- Transactional update ---
  try {
    await prisma.$transaction(async (tx) => {
      // 1. User-level fields
      const userUpdate: Record<string, unknown> = {};
      if (data.name !== undefined) userUpdate.name = data.name.trim();
      if (Object.keys(userUpdate).length > 0) {
        await tx.user.update({ where: { id: targetUserId }, data: userUpdate });
      }

      // 2. DriverProfile fields
      const profileUpdate: Record<string, unknown> = {};
      if (data.vehicleType !== undefined) profileUpdate.vehicleType = data.vehicleType as VehicleType;
      if (data.transporterId !== undefined) profileUpdate.transporterId = data.transporterId || null;
      if (data.worksCiclo1 !== undefined) profileUpdate.worksCiclo1 = data.worksCiclo1;
      if (data.worksCiclo2 !== undefined) profileUpdate.worksCiclo2 = data.worksCiclo2;
      if (data.isTrusted !== undefined) profileUpdate.isTrusted = data.isTrusted;
      if (data.whatsappGroup !== undefined) profileUpdate.whatsappGroup = data.whatsappGroup || null;

      // Phone encryption
      if (data.phone !== undefined) {
        const normalizedPhone = data.phone.replace(/\D/g, "");
        if (normalizedPhone) {
          profileUpdate.phone = encrypt(normalizedPhone);
          profileUpdate.phoneFormatted = data.phone;
        } else {
          profileUpdate.phone = null;
          profileUpdate.phoneFormatted = null;
        }
      }

      if (Object.keys(profileUpdate).length > 0) {
        await tx.driverProfile.update({ where: { id: profile.id }, data: profileUpdate });
      }

      // 3. City preferences
      if (data.cities !== undefined) {
        await tx.regionCityPreference.deleteMany({ where: { driverProfileId: profile.id } });
        if (data.cities.length > 0) {
          await tx.regionCityPreference.createMany({
            data: data.cities.map((city, index) => ({
              driverProfileId: profile.id,
              city,
              priority: index + 1,
            })),
          });
        }
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Erro ao salvar: ${message}` };
  }

  // Audit log (outside transaction — non-critical)
  await writeAuditLog({
    eventType: "DRIVER_PROFILE_UPDATED",
    actorId,
    targetUserId,
    oldValue,
    newValue,
    justification: "Edição via menu Motoristas",
  });

  revalidatePath("/drivers");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Deactivation request flow
// ---------------------------------------------------------------------------

/**
 * Supervisor requests deactivation of a driver. The driver stays ACTIVE
 * until an Account Manager approves. Only one PENDING request per driver
 * is allowed (enforced by partial unique index + this check).
 *
 * Account Managers and Admins deactivate directly without creating a request.
 */
export async function requestDriverDeactivation(
  driverUserId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireSupervisorOrAbove();
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  const access = await resolveTransportCompanyId(actorId, actorRole);
  if (!access.ok) return { success: false, error: access.error };

  const target = await prisma.user.findUnique({
    where: { id: driverUserId },
    select: { id: true, role: true, active: true, email: true, transportCompanyId: true },
  });

  if (!target || target.role !== "DRIVER") {
    return { success: false, error: "Motorista não encontrado." };
  }
  if (!target.active) {
    return { success: false, error: "Motorista já está desativado." };
  }

  const crossCheck2 = checkCrossCompany(access.id, target.transportCompanyId);
  if (!crossCheck2.ok) {
    return { success: false, error: crossCheck2.error };
  }

  // ACCOUNT_MANAGER and ADMIN deactivate directly
  if (actorRole === "ACCOUNT_MANAGER" || actorRole === "ADMIN") {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: driverUserId },
        data: {
          active: false,
          deactivatedById: actorId,
          deactivatedByRole: actorRole,
        },
      });

      // Block AllowedEmail
      await tx.allowedEmail.updateMany({
        where: { email: target.email, status: "ACTIVE" },
        data: { status: "BLOCKED" },
      });

      // Cancel any pending deactivation requests for this driver (inside transaction for atomicity)
      await cancelPendingDeactivationRequests(
        driverUserId,
        actorId,
        "Cancelado: motorista desativado diretamente por gerente/admin",
        tx,
      );
    });

    await writeAuditLog({
      eventType: "USER_DEACTIVATED",
      actorId,
      targetUserId: driverUserId,
      oldValue: { active: true },
      newValue: { active: false, deactivatedByRole: actorRole },
      justification: reason.trim() || "Desativação direta via menu Motoristas",
    });

    revalidatePath("/drivers");
    revalidatePath("/drivers/deactivation-requests");
    return { success: true };
  }

  // SUPERVISOR creates a deactivation request
  // Check for existing PENDING request (friendly error before hitting unique index)
  const existingPending = await prisma.deactivationRequest.findFirst({
    where: { driverUserId, status: "PENDING" },
    select: { id: true },
  });
  if (existingPending) {
    return { success: false, error: "Já existe uma solicitação pendente para este motorista." };
  }

  await prisma.deactivationRequest.create({
    data: {
      driverUserId,
      requestedById: actorId,
      status: "PENDING",
      reason: reason.trim() || null,
    },
  });

  await writeAuditLog({
    eventType: "DEACTIVATION_REQUEST_CREATED",
    actorId,
    targetUserId: driverUserId,
    metadata: { reason: reason.trim() || null },
  });

  revalidatePath("/drivers");
  revalidatePath("/drivers/deactivation-requests");
  return { success: true };
}

/**
 * Account Manager or Admin reviews a deactivation request.
 * If APPROVED: deactivates the driver (reusing deactivateUser logic inline).
 * If REJECTED: marks the request as rejected.
 */
export async function reviewDeactivationRequest(
  requestId: string,
  decision: "APPROVED" | "REJECTED",
  notes?: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Não autenticado.");
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  if (!roleIsAtLeast(actorRole, "ACCOUNT_MANAGER")) {
    return { success: false, error: "Apenas gerentes de conta e administradores podem revisar solicitações." };
  }

  const request = await prisma.deactivationRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      driverUserId: true,
      driver: { select: { id: true, email: true, active: true, role: true } },
    },
  });

  if (!request) {
    return { success: false, error: "Solicitação não encontrada." };
  }
  if (request.status !== "PENDING") {
    return { success: false, error: "Esta solicitação já foi revisada." };
  }

  const now = new Date();

  if (decision === "REJECTED") {
    await prisma.deactivationRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        reviewerId: actorId,
        reviewedAt: now,
        reviewNotes: notes?.trim() || null,
      },
    });

    await writeAuditLog({
      eventType: "DEACTIVATION_REQUEST_REJECTED",
      actorId,
      targetUserId: request.driverUserId,
      metadata: { requestId, notes: notes?.trim() || null },
    });

    revalidatePath("/drivers/deactivation-requests");
    return { success: true };
  }

  // APPROVED: deactivate the driver
  // Reuse the same logic as admin/users/actions.ts deactivateUser
  // but within this context. Record deactivatedByRole = reviewer's role.
  await prisma.$transaction(async (tx) => {
    // Update the request
    await tx.deactivationRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        reviewerId: actorId,
        reviewedAt: now,
        reviewNotes: notes?.trim() || null,
      },
    });

    // Deactivate user
    await tx.user.update({
      where: { id: request.driverUserId },
      data: {
        active: false,
        deactivatedById: actorId,
        deactivatedByRole: actorRole,
      },
    });

    // Block AllowedEmail
    await tx.allowedEmail.updateMany({
      where: { email: request.driver.email, status: "ACTIVE" },
      data: { status: "BLOCKED" },
    });
  });

  await writeAuditLog({
    eventType: "DEACTIVATION_REQUEST_APPROVED",
    actorId,
    targetUserId: request.driverUserId,
    metadata: { requestId },
  });

  await writeAuditLog({
    eventType: "USER_DEACTIVATED",
    actorId,
    targetUserId: request.driverUserId,
    oldValue: { active: true },
    newValue: { active: false, deactivatedByRole: actorRole },
    justification: `Desativação aprovada via solicitação ${requestId}`,
  });

  revalidatePath("/drivers");
  revalidatePath("/drivers/deactivation-requests");
  return { success: true };
}

/**
 * Cancel all PENDING deactivation requests for a driver.
 * Called when a driver is deactivated/reactivated through another path
 * (e.g., /admin/users). This prevents orphaned pending requests.
 *
 * Can be called with an optional transaction client for atomicity.
 */
export async function cancelPendingDeactivationRequests(
  driverUserId: string,
  actorId: string,
  reason: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<void> {
  const db = tx ?? prisma;

  const pendingRequests = await db.deactivationRequest.findMany({
    where: { driverUserId, status: "PENDING" },
    select: { id: true },
  });

  if (pendingRequests.length === 0) return;

  await db.deactivationRequest.updateMany({
    where: { driverUserId, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewedAt: new Date(),
      reviewNotes: reason,
    },
  });

  // Audit each cancellation (only outside transaction to avoid nested issues)
  if (!tx) {
    for (const req of pendingRequests) {
      await writeAuditLog({
        eventType: "DEACTIVATION_REQUEST_CANCELLED",
        actorId,
        targetUserId: driverUserId,
        metadata: { requestId: req.id, reason },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// List helpers for the UI
// ---------------------------------------------------------------------------

export async function listPendingDeactivationRequests() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Não autenticado.");
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  if (!roleIsAtLeast(actorRole, "ACCOUNT_MANAGER")) {
    // Supervisors can see their own requests
    if (actorRole !== "SUPERVISOR") {
      throw new Error("Permissão insuficiente.");
    }
  }

  // Resolve actor's transport company for read isolation
  const access = await resolveTransportCompanyId(actorId, actorRole);
  if (!access.ok) {
    throw new Error(access.error);
  }

  const where: Record<string, unknown> = { status: "PENDING" };
  if (access.id) {
    where.driver = { transportCompanyId: access.id };
  }

  const requests = await prisma.deactivationRequest.findMany({
    where,
    select: {
      id: true,
      reason: true,
      createdAt: true,
      driver: { select: { id: true, name: true, email: true } },
      requestedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return requests;
}

export async function listResolvedDeactivationRequests() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Não autenticado.");
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  // Resolve actor's transport company for read isolation
  const access = await resolveTransportCompanyId(actorId, actorRole);
  if (!access.ok) {
    throw new Error(access.error);
  }

  const where: Record<string, unknown> = { status: { in: ["APPROVED", "REJECTED"] } };
  if (access.id) {
    where.driver = { transportCompanyId: access.id };
  }

  const requests = await prisma.deactivationRequest.findMany({
    where,
    select: {
      id: true,
      status: true,
      reason: true,
      reviewNotes: true,
      createdAt: true,
      reviewedAt: true,
      driver: { select: { id: true, name: true, email: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
    },
    orderBy: { reviewedAt: "desc" },
    take: 100,
  });

  return requests;
}

export async function getPendingDeactivationCount(transportCompanyId?: string | null): Promise<number> {
  const where: Record<string, unknown> = { status: "PENDING" };
  if (transportCompanyId) {
    where.driver = { transportCompanyId };
  }
  return prisma.deactivationRequest.count({ where });
}
