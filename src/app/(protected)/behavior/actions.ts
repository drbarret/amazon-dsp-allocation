"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { roleIsAtLeast } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { UserRole } from "@/generated/prisma";
import {
  INFRACTION_TYPES,
  getInfractionRule,
  computeEffectiveWeek,
  computeMultiplier,
  isRecidivismMark,
  describePunishment,
} from "@/lib/behavior";

async function requireSupervisorPlus() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Não autenticado.");
  }
  if (!roleIsAtLeast(session.user.role as UserRole, "SUPERVISOR")) {
    throw new Error("Permissão insuficiente.");
  }
  return session;
}

async function requireAccountManagerPlus() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Não autenticado.");
  }
  if (!roleIsAtLeast(session.user.role as UserRole, "ACCOUNT_MANAGER")) {
    throw new Error("Permissão insuficiente.");
  }
  return session;
}

async function getUserTransportCompanyId(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { transportCompanyId: true },
  });
  return user?.transportCompanyId ?? null;
}

const markSchema = z.object({
  driverProfileId: z.string().min(1, "Motorista é obrigatório."),
  type: z.enum(
    [
      "NAO_REVERTER_INSUCESSOS",
      "RECLAMACAO_ASPERA",
      "FALTAS_RECORRENTES",
      "ABANDONO_ROTA",
      "DESCUMPRIR_REGRAS_AMAZON",
    ],
    { message: "Tipo de infração inválido." }
  ),
  dispatchWeekId: z.string().min(1, "Semana é obrigatória."),
  observation: z.string().max(500, "Observação muito longa.").optional().or(z.literal("")),
});

/**
 * Mark a behavior infraction. The supervisor chooses WHICH infraction occurred;
 * the system decides the punishment (weight is by type, never by supervisor).
 *
 * - RECLAMACAO_ASPERA (subjective) starts PENDING_APPROVAL and only becomes a
 *   punishment after an account manager approves it.
 * - The other 4 types start ACTIVE immediately.
 * - The punishment applies the week AFTER the marked week.
 * - Recidivism (active punishment or within the window after fulfillment)
 *   doubles the punishment and notifies the supervisor.
 */
export async function markInfraction(input: unknown) {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;

  const parsed = markSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { success: false, error: first?.message ?? "Dados inválidos." };
  }

  const { driverProfileId, type, dispatchWeekId, observation } = parsed.data;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora." };
  }

  // The driver must belong to the same transport company.
  const driver = await prisma.driverProfile.findUnique({
    where: { id: driverProfileId },
    include: { user: { select: { transportCompanyId: true, active: true } } },
  });
  if (!driver || driver.user.transportCompanyId !== transportCompanyId) {
    return { success: false, error: "Motorista não encontrado na sua transportadora." };
  }

  const week = await prisma.dispatchWeek.findUnique({
    where: { id: dispatchWeekId },
    select: { transportCompanyId: true, startDate: true, endDate: true, weekKey: true },
  });
  if (!week || week.transportCompanyId !== transportCompanyId) {
    return { success: false, error: "Semana não pertence à sua transportadora." };
  }

  const rule = getInfractionRule(type);
  const effective = computeEffectiveWeek(week.startDate, week.endDate);

  // Determine recidivism: an active/pending punishment, or a fulfilled one
  // within the recidivism window.
  const [activeCount, lastFulfilled] = await Promise.all([
    prisma.driverInfraction.count({
      where: {
        driverProfileId,
        status: { in: ["ACTIVE", "PENDING_APPROVAL"] },
      },
    }),
    prisma.driverInfraction.findFirst({
      where: { driverProfileId, status: "FULFILLED" },
      orderBy: { fulfilledAt: "desc" },
      select: { fulfilledAt: true },
    }),
  ]);
  const recidivism = isRecidivismMark(
    activeCount > 0,
    lastFulfilled?.fulfilledAt ?? null,
    new Date()
  );
  const multiplier = computeMultiplier(recidivism);

  const status = rule.requiresApproval ? "PENDING_APPROVAL" : "ACTIVE";

  const infraction = await prisma.driverInfraction.create({
    data: {
      driverProfileId,
      type,
      observation: observation?.trim() || null,
      weekKey: week.weekKey,
      effectiveWeekKey: week.weekKey, // placeholder; refined below
      effectiveStartDate: effective.start,
      effectiveEndDate: effective.end,
      status,
      multiplier,
      markedById: actorId,
      // Recidivism notifies the supervisor immediately.
      supervisorNotifiedAt: recidivism ? new Date() : null,
    },
  });

  await writeAuditLog({
    eventType: recidivism ? "RECIDIVISM_WARNING" : "INFRACTION_MARKED",
    actorId,
    targetUserId: driver.userId,
    metadata: {
      infractionId: infraction.id,
      type,
      multiplier,
      requiresApproval: rule.requiresApproval,
      effectiveStartDate: effective.start.toISOString().split("T")[0],
      effectiveEndDate: effective.end.toISOString().split("T")[0],
    },
  });

  revalidatePath("/behavior");
  revalidatePath("/dispatch");
  return {
    success: true,
    infraction: {
      id: infraction.id,
      status,
      multiplier,
      punishment: describePunishment(type, multiplier),
      recidivism,
    },
  };
}

/**
 * Account manager approves a subjective (RECLAMACAO_ASPERA) infraction,
 * turning it into an active punishment.
 */
export async function approveInfraction(infractionId: string) {
  const session = await requireAccountManagerPlus();
  const actorId = session.user.id;

  const infraction = await prisma.driverInfraction.findUnique({
    where: { id: infractionId },
  });
  if (!infraction) {
    return { success: false, error: "Infração não encontrada." };
  }
  if (infraction.status !== "PENDING_APPROVAL") {
    return { success: false, error: "Esta infração não está aguardando aprovação." };
  }

  await prisma.driverInfraction.update({
    where: { id: infractionId },
    data: { status: "ACTIVE", approvedById: actorId, approvedAt: new Date() },
  });

  await writeAuditLog({
    eventType: "INFRACTION_APPROVED",
    actorId,
    targetUserId: infraction.driverProfileId,
    metadata: { infractionId, type: infraction.type },
  });

  revalidatePath("/behavior");
  return { success: true };
}

/**
 * Account manager rejects a subjective infraction.
 */
export async function rejectInfraction(infractionId: string) {
  const session = await requireAccountManagerPlus();
  const actorId = session.user.id;

  const infraction = await prisma.driverInfraction.findUnique({
    where: { id: infractionId },
  });
  if (!infraction) {
    return { success: false, error: "Infração não encontrada." };
  }
  if (infraction.status !== "PENDING_APPROVAL") {
    return { success: false, error: "Esta infração não está aguardando aprovação." };
  }

  await prisma.driverInfraction.update({
    where: { id: infractionId },
    data: { status: "CANCELLED" },
  });

  await writeAuditLog({
    eventType: "INFRACTION_REJECTED",
    actorId,
    targetUserId: infraction.driverProfileId,
    metadata: { infractionId, type: infraction.type },
  });

  revalidatePath("/behavior");
  return { success: true };
}

/**
 * Escalate a recidivism warning to the account managers. Escalation is
 * normally triggered automatically by the next distribution cycle (see
 * runDistribution); this action is a manual fallback for an account manager.
 */
export async function escalateRecidivism(infractionId: string) {
  const session = await requireAccountManagerPlus();
  const actorId = session.user.id;

  const infraction = await prisma.driverInfraction.findUnique({
    where: { id: infractionId },
  });
  if (!infraction) {
    return { success: false, error: "Infração não encontrada." };
  }
  if (!infraction.supervisorNotifiedAt) {
    return { success: false, error: "Esta infração não tem aviso de reincidência." };
  }

  await prisma.driverInfraction.update({
    where: { id: infractionId },
    data: { escalatedAt: new Date() },
  });

  await writeAuditLog({
    eventType: "RECIDIVISM_ESCALATED",
    actorId,
    targetUserId: infraction.driverProfileId,
    metadata: { infractionId, type: infraction.type },
  });

  revalidatePath("/behavior");
  return { success: true };
}

const infractionInclude = {
  driverProfile: {
    include: { user: { select: { id: true, name: true, email: true, active: true } } },
  },
  markedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} as const;

/**
 * List infractions for the behavior panel. Supervisors see their company's
 * infractions; account managers additionally see the approval queue and
 * escalation items.
 */
export async function listInfractions() {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora.", data: null };
  }

  const driverIds = await prisma.driverProfile.findMany({
    where: { user: { transportCompanyId } },
    select: { id: true },
  });
  const driverIdSet = new Set(driverIds.map((d) => d.id));

  const infractions = await prisma.driverInfraction.findMany({
    where: { driverProfileId: { in: [...driverIdSet] } },
    include: infractionInclude,
    orderBy: { createdAt: "desc" },
  });

  const data = infractions.map((i) => ({
    id: i.id,
    type: i.type,
    typeLabel: INFRACTION_TYPES[i.type].label,
    punishment: describePunishment(i.type, i.multiplier),
    observation: i.observation,
    weekKey: i.weekKey,
    effectiveWeekKey: i.effectiveWeekKey,
    effectiveStartDate: i.effectiveStartDate.toISOString().split("T")[0],
    effectiveEndDate: i.effectiveEndDate.toISOString().split("T")[0],
    status: i.status,
    multiplier: i.multiplier,
    driverName: i.driverProfile.user.name,
    driverUserId: i.driverProfile.user.id,
    markedByName: i.markedBy?.name ?? null,
    approvedByName: i.approvedBy?.name ?? null,
    createdAt: i.createdAt.toISOString(),
    fulfilledAt: i.fulfilledAt?.toISOString() ?? null,
    supervisorNotifiedAt: i.supervisorNotifiedAt?.toISOString() ?? null,
    escalatedAt: i.escalatedAt?.toISOString() ?? null,
    // Escalation is triggered by the next distribution cycle, not by elapsed
    // time. A warning is "pending escalation" while the supervisor has not
    // decided (driver still active) and it has not been escalated yet.
    escalationDue:
      i.supervisorNotifiedAt != null &&
      i.escalatedAt == null &&
      i.driverProfile.user.active,
  }));

  const approvalQueue = data.filter((i) => i.status === "PENDING_APPROVAL");
  const pending = data.filter((i) => i.status === "ACTIVE");
  const recidivismWarnings = data.filter(
    (i) => i.supervisorNotifiedAt && i.status !== "CANCELLED"
  );

  return {
    success: true,
    data: {
      infractions: data,
      approvalQueue,
      pending,
      recidivismWarnings,
      canApprove: roleIsAtLeast(actorRole, "ACCOUNT_MANAGER"),
    },
  };
}
