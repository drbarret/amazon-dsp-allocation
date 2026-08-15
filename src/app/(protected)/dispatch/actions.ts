"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { roleIsAtLeast } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { allocateVacancies } from "@/lib/distribution-engine";
import {
  applyPunishmentsToDrivers,
  resolvePunishmentOutcomes,
} from "@/lib/behavior-distribution";
import { addWeeks } from "@/lib/behavior";
import type { UserRole, VehicleType } from "@/generated/prisma";

const VEHICLE_TYPES: VehicleType[] = ["CARGO_VAN", "LARGE_VAN", "PASSEIO"];

async function requireSupervisorPlus() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Não autenticado.");
  }
  const role = session.user.role as UserRole;
  if (!roleIsAtLeast(role, "SUPERVISOR")) {
    throw new Error("Permissão insuficiente.");
  }
  return session;
}

const vacancySchema = z.object({
  dispatchWeekId: z.string().min(1, "Semana é obrigatória."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD."),
  vehicleType: z.enum(["CARGO_VAN", "LARGE_VAN", "PASSEIO"], {
    message: "Categoria de veículo inválida.",
  }),
  shiftBlock: z.string().min(1, "Bloco/turno é obrigatório."),
  quantity: z.coerce.number().int().min(1, "Quantidade deve ser pelo menos 1."),
});

async function getUserTransportCompanyId(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { transportCompanyId: true },
  });
  return user?.transportCompanyId ?? null;
}

export async function createVacancy(input: unknown) {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;

  const parsed = vacancySchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { success: false, error: first?.message ?? "Dados inválidos." };
  }

  const { dispatchWeekId, date, vehicleType, shiftBlock, quantity } = parsed.data;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora." };
  }

  const week = await prisma.dispatchWeek.findUnique({
    where: { id: dispatchWeekId },
    select: { transportCompanyId: true },
  });
  if (!week) {
    return { success: false, error: "Semana não encontrada." };
  }
  if (week.transportCompanyId !== transportCompanyId) {
    return { success: false, error: "Semana não pertence à sua transportadora." };
  }

  try {
    const vacancy = await prisma.vacancy.create({
      data: {
        dispatchWeekId,
        date: new Date(`${date}T00:00:00.000Z`),
        vehicleType,
        shiftBlock: shiftBlock.trim(),
        quantity,
        createdById: actorId,
      },
    });

    await writeAuditLog({
      eventType: "VACANCY_PUBLISHED",
      actorId,
      metadata: {
        vacancyId: vacancy.id,
        dispatchWeekId,
        date,
        vehicleType,
        shiftBlock,
        quantity,
      },
    });

    revalidatePath("/dispatch");
    return { success: true, vacancy };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) {
      return { success: false, error: "Já existe uma vaga idêntica para esta data e turno." };
    }
    return { success: false, error: "Erro ao criar vaga." };
  }
}

export async function updateVacancy(id: string, input: unknown) {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;

  const parsed = vacancySchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { success: false, error: first?.message ?? "Dados inválidos." };
  }

  const { dispatchWeekId, date, vehicleType, shiftBlock, quantity } = parsed.data;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora." };
  }

  const existing = await prisma.vacancy.findUnique({
    where: { id },
    include: { dispatchWeek: { select: { transportCompanyId: true } } },
  });
  if (!existing) {
    return { success: false, error: "Vaga não encontrada." };
  }
  if (existing.dispatchWeek.transportCompanyId !== transportCompanyId) {
    return { success: false, error: "Vaga não pertence à sua transportadora." };
  }

  const targetWeek = await prisma.dispatchWeek.findUnique({
    where: { id: dispatchWeekId },
    select: { transportCompanyId: true },
  });
  if (!targetWeek) {
    return { success: false, error: "Semana não encontrada." };
  }
  if (targetWeek.transportCompanyId !== transportCompanyId) {
    return { success: false, error: "Semana não pertence à sua transportadora." };
  }

  try {
    const vacancy = await prisma.vacancy.update({
      where: { id },
      data: {
        dispatchWeekId,
        date: new Date(`${date}T00:00:00.000Z`),
        vehicleType,
        shiftBlock: shiftBlock.trim(),
        quantity,
      },
    });

    await writeAuditLog({
      eventType: "VACANCY_UPDATED",
      actorId,
      metadata: {
        vacancyId: id,
        dispatchWeekId,
        date,
        vehicleType,
        shiftBlock,
        quantity,
      },
      oldValue: {
        dispatchWeekId: existing.dispatchWeekId,
        date: existing.date.toISOString().split("T")[0],
        vehicleType: existing.vehicleType,
        shiftBlock: existing.shiftBlock,
        quantity: existing.quantity,
      },
      newValue: {
        dispatchWeekId,
        date,
        vehicleType,
        shiftBlock,
        quantity,
      },
    });

    revalidatePath("/dispatch");
    return { success: true, vacancy };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) {
      return { success: false, error: "Já existe uma vaga idêntica para esta data e turno." };
    }
    return { success: false, error: "Erro ao atualizar vaga." };
  }
}

export async function deleteVacancy(id: string) {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora." };
  }

  const existing = await prisma.vacancy.findUnique({
    where: { id },
    include: { dispatchWeek: { select: { transportCompanyId: true } } },
  });
  if (!existing) {
    return { success: false, error: "Vaga não encontrada." };
  }
  if (existing.dispatchWeek.transportCompanyId !== transportCompanyId) {
    return { success: false, error: "Vaga não pertence à sua transportadora." };
  }

  await prisma.vacancy.delete({ where: { id } });

  await writeAuditLog({
    eventType: "VACANCY_UPDATED",
    actorId,
    metadata: { vacancyId: id, action: "DELETE" },
    oldValue: {
      dispatchWeekId: existing.dispatchWeekId,
      date: existing.date.toISOString().split("T")[0],
      vehicleType: existing.vehicleType,
      shiftBlock: existing.shiftBlock,
      quantity: existing.quantity,
    },
  });

  revalidatePath("/dispatch");
  return { success: true };
}

export async function listVacancies(dispatchWeekId: string) {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora.", vacancies: [] };
  }

  const week = await prisma.dispatchWeek.findUnique({
    where: { id: dispatchWeekId },
    select: { transportCompanyId: true },
  });
  if (!week) {
    return { success: false, error: "Semana não encontrada.", vacancies: [] };
  }
  if (week.transportCompanyId !== transportCompanyId) {
    return { success: false, error: "Semana não pertence à sua transportadora.", vacancies: [] };
  }

  const vacancies = await prisma.vacancy.findMany({
    where: { dispatchWeekId },
    orderBy: [{ date: "asc" }, { shiftBlock: "asc" }, { vehicleType: "asc" }],
  });

  return { success: true, vacancies };
}

export async function listActiveDrivers() {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora.", drivers: [] };
  }

  const drivers = await prisma.user.findMany({
    where: {
      transportCompanyId,
      role: "DRIVER",
      active: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      driverProfile: {
        select: {
          id: true,
          vehicleType: true,
          onboardingCompleted: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return { success: true, drivers };
}

export async function listDispatchWeeks() {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora.", weeks: [] };
  }

  const weeks = await prisma.dispatchWeek.findMany({
    where: { transportCompanyId },
    orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
  });

  return { success: true, weeks };
}

export interface RunDistributionResult {
  assignedCount: number;
  unassignedCount: number;
  underQuotaCount: number;
  expiredCnhCount: number;
  assignments: {
    vacancyId: string;
    driverProfileId: string;
    userId: string;
    name: string;
    vehicleType: VehicleType;
    date: Date;
    shiftBlock: string;
    cnhExpired: boolean;
  }[];
  unassignedVacancies: {
    id: string;
    date: Date;
    vehicleType: VehicleType;
    shiftBlock: string;
    quantity: number;
  }[];
  underQuotaDrivers: {
    driverProfileId: string;
    userId: string;
    name: string;
    vehicleType: VehicleType;
    assignedCount: number;
  }[];
}

/**
 * Run the distribution algorithm for a week and persist the resulting
 * assignments. Idempotent: any previous assignments for the week are replaced.
 */
export async function runDistribution(
  weekId: string
): Promise<{ success: boolean; error?: string; result?: RunDistributionResult }> {
  const session = await requireSupervisorPlus();
  const actorId = session.user.id;

  const transportCompanyId = await getUserTransportCompanyId(actorId);
  if (!transportCompanyId) {
    return { success: false, error: "Usuário não vinculado a uma transportadora." };
  }

  const week = await prisma.dispatchWeek.findUnique({
    where: { id: weekId },
  });
  if (!week) {
    return { success: false, error: "Semana não encontrada." };
  }
  if (week.transportCompanyId !== transportCompanyId) {
    return { success: false, error: "Semana não pertence à sua transportadora." };
  }

  // Load vacancies and active drivers for the week.
  const [vacancies, activeUsers] = await Promise.all([
    prisma.vacancy.findMany({
      where: { dispatchWeekId: weekId },
      orderBy: [{ date: "asc" }, { shiftBlock: "asc" }, { vehicleType: "asc" }],
    }),
    prisma.user.findMany({
      where: {
        transportCompanyId,
        role: "DRIVER",
        active: true,
      },
      select: {
        id: true,
        name: true,
        driverProfile: {
          select: {
            id: true,
            vehicleType: true,
            cnhExpiration: true,
          },
        },
      },
    }),
  ]);

  const drivers = activeUsers
    .filter((u) => u.driverProfile)
    .map((u) => ({
      driverProfileId: u.driverProfile!.id,
      userId: u.id,
      name: u.name,
      vehicleType: u.driverProfile!.vehicleType,
      active: true,
      cnhExpiration: u.driverProfile!.cnhExpiration,
    }));

  // Load ACTIVE behavior punishments for THIS company's drivers whose
  // effective week overlaps this week. Scoping to the company's driver
  // profiles prevents one company's distribution from affecting another's
  // infractions. The punishment wins over the 3-vacancy minimum (intentional).
  const companyDriverProfileIds = drivers.map((d) => d.driverProfileId);
  const activeInfractions = await prisma.driverInfraction.findMany({
    where: {
      status: "ACTIVE",
      driverProfileId: { in: companyDriverProfileIds },
      effectiveStartDate: { lte: week.endDate },
      effectiveEndDate: { gte: week.startDate },
    },
  });
  const punishmentEffects = applyPunishmentsToDrivers(activeInfractions);

  const driversWithPunishments = drivers.map((d) => {
    const effect = punishmentEffects.get(d.driverProfileId);
    if (!effect) return d;
    return {
      ...d,
      quotaReduction: effect.quotaReduction,
      excluded: effect.excluded,
    };
  });

  const result = allocateVacancies({ week, vacancies, drivers: driversWithPunishments });

  // Persist assignments inside a transaction, replacing previous ones.
  await prisma.$transaction(async (tx) => {
    // Remove previous assignments for this week's vacancies.
    const vacancyIds = vacancies.map((v) => v.id);
    if (vacancyIds.length > 0) {
      await tx.dispatchAssignment.deleteMany({
        where: { vacancyId: { in: vacancyIds } },
      });
    }

    if (result.assignments.length > 0) {
      await tx.dispatchAssignment.createMany({
        data: result.assignments.map((a) => ({
          vacancyId: a.vacancyId,
          driverProfileId: a.driverProfileId,
          assignedByUserId: actorId,
          status: "PENDING",
        })),
      });
    }
  });

  // Resolve punishment outcomes for the distributed week and persist them.
  // A fulfilled punishment is zeroed automatically (the driver competes on
  // equal footing again); an unfulfilled one rolls to the next week.
  if (activeInfractions.length > 0) {
    const assignedCountByDriver = new Map<string, number>();
    for (const a of result.assignments) {
      assignedCountByDriver.set(
        a.driverProfileId,
        (assignedCountByDriver.get(a.driverProfileId) ?? 0) + 1
      );
    }
    const outcomes = resolvePunishmentOutcomes(activeInfractions, assignedCountByDriver);
    for (const outcome of outcomes) {
      if (outcome.fulfilled) {
        await prisma.driverInfraction.update({
          where: { id: outcome.infractionId },
          data: { status: "FULFILLED", fulfilledAt: new Date() },
        });
        await writeAuditLog({
          eventType: "INFRACTION_FULFILLED",
          actorId,
          metadata: { infractionId: outcome.infractionId },
        });
      } else {
        await prisma.driverInfraction.update({
          where: { id: outcome.infractionId },
          data: {
            effectiveStartDate: outcome.nextStart!,
            effectiveEndDate: outcome.nextEnd!,
            effectiveWeekKey: addWeeks(week.startDate, 1).toISOString().split("T")[0],
            ...(outcome.nextWeeksServed !== undefined
              ? { weeksServed: outcome.nextWeeksServed }
              : {}),
          },
        });
      }
    }
  }

  // Audit: who ran it and how many vacancies were assigned.
  await writeAuditLog({
    eventType: "ALLOCATION_RUN",
    actorId,
    metadata: {
      dispatchWeekId: weekId,
      assignedCount: result.assignments.length,
      unassignedCount: result.unassignedVacancies.length,
      underQuotaCount: result.underQuotaDrivers.length,
      expiredCnhCount: result.expiredCnhAssignments.length,
    },
  });

  revalidatePath("/dispatch");

  const driverNameById = new Map(drivers.map((d) => [d.driverProfileId, d.name]));
  const driverUserById = new Map(drivers.map((d) => [d.driverProfileId, d.userId]));
  const expiredSet = new Set(result.expiredCnhAssignments);

  const assignedCountByDriver = new Map<string, number>();
  for (const a of result.assignments) {
    assignedCountByDriver.set(
      a.driverProfileId,
      (assignedCountByDriver.get(a.driverProfileId) ?? 0) + 1
    );
  }

  return {
    success: true,
    result: {
      assignedCount: result.assignments.length,
      unassignedCount: result.unassignedVacancies.length,
      underQuotaCount: result.underQuotaDrivers.length,
      expiredCnhCount: result.expiredCnhAssignments.length,
      assignments: result.assignments.map((a) => ({
        vacancyId: a.vacancyId,
        driverProfileId: a.driverProfileId,
        userId: a.userId,
        name: driverNameById.get(a.driverProfileId) ?? "—",
        vehicleType: a.vehicleType,
        date: a.date,
        shiftBlock: a.shiftBlock,
        cnhExpired: expiredSet.has(a.driverProfileId),
      })),
      unassignedVacancies: result.unassignedVacancies.map((v) => ({
        id: v.id,
        date: v.date,
        vehicleType: v.vehicleType,
        shiftBlock: v.shiftBlock,
        quantity: v.quantity,
      })),
      underQuotaDrivers: result.underQuotaDrivers.map((d) => ({
        driverProfileId: d.driverProfileId,
        userId: driverUserById.get(d.driverProfileId) ?? d.userId,
        name: d.name,
        vehicleType: d.vehicleType,
        assignedCount: assignedCountByDriver.get(d.driverProfileId) ?? 0,
      })),
    },
  };
}

export { VEHICLE_TYPES };
export type { VehicleType };