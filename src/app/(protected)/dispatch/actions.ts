"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { roleIsAtLeast } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { z } from "zod";
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

export { VEHICLE_TYPES };
export type { VehicleType };
