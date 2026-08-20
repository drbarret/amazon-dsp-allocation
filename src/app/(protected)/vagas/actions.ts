"use server";

import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { UserRole, VehicleEligibility } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Helpers (same pattern as disponibilidades/actions.ts)
// ---------------------------------------------------------------------------

const MANAGEMENT_ROLES: UserRole[] = ["ADMIN", "ACCOUNT_MANAGER"];

async function resolveTransportCompanyId(
  actorId: string,
  actorRole: UserRole,
  requestedTransportCompanyId?: string | null
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { transportCompanyId: true },
  });

  const ownTransportCompanyId = user?.transportCompanyId ?? null;

  if (ownTransportCompanyId) {
    if (requestedTransportCompanyId && requestedTransportCompanyId !== ownTransportCompanyId) {
      return { ok: false, error: "Sem permissão para acessar outra transportadora." };
    }
    return { ok: true, id: ownTransportCompanyId };
  }

  if (!MANAGEMENT_ROLES.includes(actorRole)) {
    return { ok: false, error: "Usuário não vinculado a uma transportadora." };
  }

  const targetId = requestedTransportCompanyId ?? null;
  if (!targetId) {
    return { ok: false, error: "Selecione uma transportadora." };
  }

  const company = await prisma.transportCompany.findUnique({
    where: { id: targetId },
    select: { id: true },
  });
  if (!company) {
    return { ok: false, error: "Transportadora não encontrada." };
  }

  return { ok: true, id: company.id };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VacancyBlockRow {
  id: string;
  name: string;
  cycle: number;
  eligibleVehicleTypes: VehicleEligibility[];
  shift: string | null;
  active: boolean;
  sortOrder: number;
  dailyVacancies: { dayOfWeek: number; count: number }[];
  total: number;
}

export interface ListVacancyBlocksResult {
  success: boolean;
  error?: string;
  blocks: VacancyBlockRow[];
}

export interface MutationResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Lists active vacancy blocks for the given week, including daily counts and totals.
 */
export async function listVacancyBlocks(
  weekId: string,
  transportCompanyId?: string
): Promise<ListVacancyBlocksResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  const access = await resolveTransportCompanyId(
    actorId,
    session.user.role as UserRole,
    transportCompanyId
  );
  if (!access.ok) {
    return { success: false, error: access.error, blocks: [] };
  }
  const effectiveTransportCompanyId = access.id;

  // Validate week belongs to the company
  const week = await prisma.dispatchWeek.findUnique({
    where: { id: weekId },
    select: { transportCompanyId: true },
  });
  if (!week) {
    return { success: false, error: "Semana não encontrada.", blocks: [] };
  }
  if (week.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, error: "Semana não pertence à transportadora selecionada.", blocks: [] };
  }

  // Fetch blocks + daily vacancies in a single query to avoid N+1
  const blocks = await prisma.vacancyBlock.findMany({
    where: {
      transportCompanyId: effectiveTransportCompanyId,
      active: true,
    },
    include: {
      dailyVacancies: {
        where: { dispatchWeekId: weekId },
        select: { dayOfWeek: true, count: true },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  const result: VacancyBlockRow[] = blocks.map((b) => ({
    id: b.id,
    name: b.name,
    cycle: b.cycle,
    eligibleVehicleTypes: b.eligibleVehicleTypes,
    shift: b.shift,
    active: b.active,
    sortOrder: b.sortOrder,
    dailyVacancies: b.dailyVacancies.map((dv) => ({
      dayOfWeek: dv.dayOfWeek,
      count: dv.count,
    })),
    total: b.dailyVacancies.reduce((sum, dv) => sum + dv.count, 0),
  }));

  return { success: true, blocks: result };
}

/**
 * Upserts a single daily vacancy cell.
 */
export async function setDailyVacancy(
  blockId: string,
  weekId: string,
  dayOfWeek: number,
  count: number,
  transportCompanyId?: string
): Promise<MutationResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  // Validate inputs
  if (!Number.isInteger(count) || count < 0) {
    return { success: false, error: "count deve ser um inteiro >= 0." };
  }
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { success: false, error: "dayOfWeek deve estar entre 0 e 6." };
  }

  const access = await resolveTransportCompanyId(
    actorId,
    session.user.role as UserRole,
    transportCompanyId
  );
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const effectiveTransportCompanyId = access.id;

  // Validate block belongs to company
  const block = await prisma.vacancyBlock.findUnique({
    where: { id: blockId },
    select: { transportCompanyId: true },
  });
  if (!block) {
    return { success: false, error: "Bloco não encontrado." };
  }
  if (block.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, error: "Bloco não pertence à transportadora selecionada." };
  }

  // Validate week belongs to company
  const week = await prisma.dispatchWeek.findUnique({
    where: { id: weekId },
    select: { transportCompanyId: true },
  });
  if (!week) {
    return { success: false, error: "Semana não encontrada." };
  }
  if (week.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, error: "Semana não pertence à transportadora selecionada." };
  }

  await prisma.blockDailyVacancy.upsert({
    where: {
      dispatchWeekId_vacancyBlockId_dayOfWeek: {
        dispatchWeekId: weekId,
        vacancyBlockId: blockId,
        dayOfWeek,
      },
    },
    create: {
      dispatchWeekId: weekId,
      vacancyBlockId: blockId,
      dayOfWeek,
      count,
      createdById: actorId,
      updatedById: actorId,
    },
    update: {
      count,
      updatedById: actorId,
    },
  });

  revalidatePath("/vagas");
  return { success: true };
}

/**
 * Saves all 7 daily vacancy values for a block in a given week.
 * `counts` must have exactly 7 positions (index 0=Dom … 6=Sáb).
 */
export async function saveBlockWeek(
  blockId: string,
  weekId: string,
  counts: number[],
  transportCompanyId?: string
): Promise<MutationResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  // Validate counts
  if (!Array.isArray(counts) || counts.length !== 7) {
    return { success: false, error: "counts deve ter exatamente 7 posições." };
  }
  for (let i = 0; i < 7; i++) {
    if (!Number.isInteger(counts[i]) || counts[i] < 0) {
      return { success: false, error: `counts[${i}] deve ser um inteiro >= 0.` };
    }
  }

  const access = await resolveTransportCompanyId(
    actorId,
    session.user.role as UserRole,
    transportCompanyId
  );
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const effectiveTransportCompanyId = access.id;

  // Validate block belongs to company
  const block = await prisma.vacancyBlock.findUnique({
    where: { id: blockId },
    select: { transportCompanyId: true },
  });
  if (!block) {
    return { success: false, error: "Bloco não encontrado." };
  }
  if (block.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, error: "Bloco não pertence à transportadora selecionada." };
  }

  // Validate week belongs to company
  const week = await prisma.dispatchWeek.findUnique({
    where: { id: weekId },
    select: { transportCompanyId: true },
  });
  if (!week) {
    return { success: false, error: "Semana não encontrada." };
  }
  if (week.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, error: "Semana não pertence à transportadora selecionada." };
  }

  // Use transaction with extended timeout to avoid P2028 (lesson from Disponibilidades)
  await prisma.$transaction(
    async (tx) => {
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        await tx.blockDailyVacancy.upsert({
          where: {
            dispatchWeekId_vacancyBlockId_dayOfWeek: {
              dispatchWeekId: weekId,
              vacancyBlockId: blockId,
              dayOfWeek,
            },
          },
          create: {
            dispatchWeekId: weekId,
            vacancyBlockId: blockId,
            dayOfWeek,
            count: counts[dayOfWeek],
            createdById: actorId,
            updatedById: actorId,
          },
          update: {
            count: counts[dayOfWeek],
            updatedById: actorId,
          },
        });
      }
    },
    { timeout: 30000 }
  );

  revalidatePath("/vagas");
  return { success: true };
}

/**
 * Updates vacancy block metadata (name, eligibleVehicleTypes, cycle, shift, active).
 */
export async function updateVacancyBlock(
  blockId: string,
  data: {
    name?: string;
    eligibleVehicleTypes?: VehicleEligibility[];
    cycle?: number;
    shift?: string | null;
    active?: boolean;
  },
  transportCompanyId?: string
): Promise<MutationResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  // Validate cycle
  if (data.cycle !== undefined && data.cycle !== 1 && data.cycle !== 2) {
    return { success: false, error: "cycle deve ser 1 ou 2." };
  }

  // Validate eligibleVehicleTypes not empty
  if (data.eligibleVehicleTypes !== undefined && data.eligibleVehicleTypes.length === 0) {
    return { success: false, error: "eligibleVehicleTypes não pode ser vazio." };
  }

  const access = await resolveTransportCompanyId(
    actorId,
    session.user.role as UserRole,
    transportCompanyId
  );
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const effectiveTransportCompanyId = access.id;

  // Validate block belongs to company
  const block = await prisma.vacancyBlock.findUnique({
    where: { id: blockId },
    select: { transportCompanyId: true },
  });
  if (!block) {
    return { success: false, error: "Bloco não encontrado." };
  }
  if (block.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, error: "Bloco não pertence à transportadora selecionada." };
  }

  await prisma.vacancyBlock.update({
    where: { id: blockId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.eligibleVehicleTypes !== undefined && { eligibleVehicleTypes: data.eligibleVehicleTypes }),
      ...(data.cycle !== undefined && { cycle: data.cycle }),
      ...(data.shift !== undefined && { shift: data.shift }),
      ...(data.active !== undefined && { active: data.active }),
      updatedById: actorId,
    },
  });

  revalidatePath("/vagas");
  return { success: true };
}
