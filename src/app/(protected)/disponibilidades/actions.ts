"use server";

import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { parseXlsxAvailability, type AvailabilityError } from "@/lib/availability/xlsx-parser";
import { revalidatePath } from "next/cache";
import type { UserRole } from "@/generated/prisma";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export interface ImportAvailabilityResult {
  success: boolean;
  week: string;
  imported: number;
  pendingApproval: number;
  errors: AvailabilityError[];
  error?: string;
}

function sanitizeString(value: unknown, maxLength = 255): string | null {
  const str = String(value ?? "").trim();
  if (str === "") return null;
  return str.slice(0, maxLength);
}

function toWeekKey(week: string): string {
  const normalized = week.trim().toUpperCase();
  if (normalized.startsWith("WK-")) return normalized;
  if (normalized.startsWith("W")) return `WK-${normalized.slice(1)}`;
  return `WK-${normalized}`;
}

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

export async function importAvailability(formData: FormData): Promise<ImportAvailabilityResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  const weekRaw = sanitizeString(formData.get("week"));
  if (!weekRaw) {
    return { success: false, week: "", imported: 0, pendingApproval: 0, errors: [], error: "Semana não informada." };
  }
  const week = weekRaw;
  const weekKey = toWeekKey(week);

  const file = formData.get("file");
  if (!file || !(file instanceof Blob) || file.size === 0) {
    return { success: false, week, imported: 0, pendingApproval: 0, errors: [], error: "Arquivo não enviado." };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { success: false, week, imported: 0, pendingApproval: 0, errors: [], error: "Arquivo excede o limite de 5MB." };
  }

  const transportCompanyId = sanitizeString(formData.get("transportCompanyId")) ?? undefined;

  const access = await resolveTransportCompanyId(
    actorId,
    session.user.role as UserRole,
    transportCompanyId
  );
  if (!access.ok) {
    return { success: false, week, imported: 0, pendingApproval: 0, errors: [], error: access.error };
  }
  const effectiveTransportCompanyId = access.id;

  const dispatchWeek = await prisma.dispatchWeek.findFirst({
    where: { weekKey, transportCompanyId: effectiveTransportCompanyId },
    select: { id: true, transportCompanyId: true },
  });
  if (!dispatchWeek) {
    return { success: false, week, imported: 0, pendingApproval: 0, errors: [], error: "Semana não encontrada. Crie a semana antes de importar." };
  }
  if (dispatchWeek.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, week, imported: 0, pendingApproval: 0, errors: [], error: "Semana não pertence à transportadora selecionada." };
  }

  const arrayBuffer = await file.arrayBuffer();
  const parseResult = await parseXlsxAvailability(Buffer.from(arrayBuffer), week);

  // Pre-fetch users to avoid N+1 queries inside the transaction and to validate
  // company membership before writing anything.
  const userIds = new Set<string>([
    ...parseResult.availabilities.map((r) => r.userId),
    ...parseResult.warnings.map((w) => w.userId).filter(Boolean) as string[],
  ]);

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, transportCompanyId: true, active: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const validAvailabilities = parseResult.availabilities.filter((record) => {
    const user = userById.get(record.userId);
    return user && user.transportCompanyId === effectiveTransportCompanyId && user.active;
  });

  const invalidAvailabilityReasons: AvailabilityError[] = parseResult.availabilities
    .filter((record) => !validAvailabilities.some((r) => r.userId === record.userId && r.row === record.row))
    .map((record) => ({
      row: record.row,
      reason: "Motorista não pertence à transportadora selecionada.",
    }));

  const validWarnings = parseResult.warnings.filter((warning) => {
    if (!warning.userId) return false;
    const user = userById.get(warning.userId);
    return user && user.transportCompanyId === effectiveTransportCompanyId;
  });

  const invalidWarningReasons: AvailabilityError[] = parseResult.warnings
    .filter((warning) => !warning.userId || !validWarnings.some((w) => w.userId === warning.userId && w.row === warning.row))
    .map((warning) => ({
      row: warning.row,
      reason: warning.userId
        ? "Motorista não pertence à transportadora selecionada."
        : warning.reason,
    }));

  const errors: AvailabilityError[] = [
    ...parseResult.errors,
    ...invalidAvailabilityReasons,
    ...invalidWarningReasons,
  ];
  let imported = 0;
  let pendingApproval = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const record of validAvailabilities) {
        const availability = await tx.driverAvailability.upsert({
          where: {
            dispatchWeekId_userId: {
              dispatchWeekId: dispatchWeek.id,
              userId: record.userId,
            },
          },
          create: {
            dispatchWeekId: dispatchWeek.id,
            userId: record.userId,
            filledAt: record.filledAt,
            importedById: actorId,
            hasNaturalGas: record.hasNaturalGas,
            isPassengerCar: record.isPassengerCar,
            sunAvailable: record.sunAvailable,
            monAvailable: record.monAvailable,
            tueAvailable: record.tueAvailable,
            wedAvailable: record.wedAvailable,
            thuAvailable: record.thuAvailable,
            friAvailable: record.friAvailable,
            satAvailable: record.satAvailable,
            speedAfternoon: record.speedAfternoon,
          },
          update: {
            filledAt: record.filledAt,
            importedById: actorId,
            hasNaturalGas: record.hasNaturalGas,
            isPassengerCar: record.isPassengerCar,
            sunAvailable: record.sunAvailable,
            monAvailable: record.monAvailable,
            tueAvailable: record.tueAvailable,
            wedAvailable: record.wedAvailable,
            thuAvailable: record.thuAvailable,
            friAvailable: record.friAvailable,
            satAvailable: record.satAvailable,
            speedAfternoon: record.speedAfternoon,
          },
        });

        // Active driver: remove any previous pending approval.
        await tx.availabilityApproval.deleteMany({
          where: { driverAvailabilityId: availability.id },
        });

        imported++;
      }

      for (const warning of validWarnings) {
        const availability = await tx.driverAvailability.upsert({
          where: {
            dispatchWeekId_userId: {
              dispatchWeekId: dispatchWeek.id,
              userId: warning.userId as string,
            },
          },
          create: {
            dispatchWeekId: dispatchWeek.id,
            userId: warning.userId as string,
            filledAt: warning.filledAt,
            importedById: actorId,
            hasNaturalGas: warning.hasNaturalGas,
            isPassengerCar: warning.isPassengerCar,
            sunAvailable: warning.sunAvailable,
            monAvailable: warning.monAvailable,
            tueAvailable: warning.tueAvailable,
            wedAvailable: warning.wedAvailable,
            thuAvailable: warning.thuAvailable,
            friAvailable: warning.friAvailable,
            satAvailable: warning.satAvailable,
            speedAfternoon: warning.speedAfternoon,
          },
          update: {
            filledAt: warning.filledAt,
            importedById: actorId,
            hasNaturalGas: warning.hasNaturalGas,
            isPassengerCar: warning.isPassengerCar,
            sunAvailable: warning.sunAvailable,
            monAvailable: warning.monAvailable,
            tueAvailable: warning.tueAvailable,
            wedAvailable: warning.wedAvailable,
            thuAvailable: warning.thuAvailable,
            friAvailable: warning.friAvailable,
            satAvailable: warning.satAvailable,
            speedAfternoon: warning.speedAfternoon,
          },
        });

        await tx.availabilityApproval.upsert({
          where: { driverAvailabilityId: availability.id },
          create: {
            driverAvailabilityId: availability.id,
            status: "PENDING",
          },
          update: {
            status: "PENDING",
            reviewerId: null,
            reviewedAt: null,
            notes: null,
          },
        });

        pendingApproval++;
      }
    },
    { timeout: 30000 }
  );

  await writeAuditLog({
    eventType: "AVAILABILITY_SUBMITTED",
    actorId,
    metadata: {
      dispatchWeekId: dispatchWeek.id,
      week,
      weekKey,
      imported,
      pendingApproval,
      errors: errors.length,
    },
  });

  revalidatePath("/disponibilidades");

  return {
    success: errors.length === 0,
    week,
    imported,
    pendingApproval,
    errors,
  };
}


export interface AvailabilityRow {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  filledAt: Date | null;
  hasNaturalGas: boolean;
  isPassengerCar: boolean;
  sunAvailable: boolean;
  monAvailable: boolean;
  tueAvailable: boolean;
  wedAvailable: boolean;
  thuAvailable: boolean;
  friAvailable: boolean;
  satAvailable: boolean;
  speedAfternoon: boolean;
  approval: { id: string; status: string; notes: string | null } | null;
}

export interface ListAvailabilitiesResult {
  success: boolean;
  error?: string;
  rows: AvailabilityRow[];
}

export async function listAvailabilities(
  dispatchWeekId: string,
  transportCompanyId?: string
): Promise<ListAvailabilitiesResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  const access = await resolveTransportCompanyId(
    actorId,
    session.user.role as UserRole,
    transportCompanyId
  );
  if (!access.ok) {
    return { success: false, error: access.error, rows: [] };
  }
  const effectiveTransportCompanyId = access.id;

  const week = await prisma.dispatchWeek.findUnique({
    where: { id: dispatchWeekId },
    select: { transportCompanyId: true },
  });
  if (!week) {
    return { success: false, error: "Semana não encontrada.", rows: [] };
  }
  if (week.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, error: "Semana não pertence à transportadora selecionada.", rows: [] };
  }

  const availabilities = await prisma.driverAvailability.findMany({
    where: { dispatchWeekId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      approval: { select: { id: true, status: true, notes: true } },
    },
    orderBy: [{ user: { name: "asc" } }],
  });

  const rows: AvailabilityRow[] = availabilities.map((a) => ({
    id: a.id,
    userId: a.userId,
    name: a.user.name,
    email: a.user.email,
    filledAt: a.filledAt,
    hasNaturalGas: a.hasNaturalGas,
    isPassengerCar: a.isPassengerCar,
    sunAvailable: a.sunAvailable,
    monAvailable: a.monAvailable,
    tueAvailable: a.tueAvailable,
    wedAvailable: a.wedAvailable,
    thuAvailable: a.thuAvailable,
    friAvailable: a.friAvailable,
    satAvailable: a.satAvailable,
    speedAfternoon: a.speedAfternoon,
    approval: a.approval
      ? { id: a.approval.id, status: a.approval.status, notes: a.approval.notes }
      : null,
  }));

  return { success: true, rows };
}

export interface ReviewAvailabilityResult {
  success: boolean;
  error?: string;
}

async function reviewAvailability(
  availabilityId: string,
  status: "APPROVED" | "REJECTED",
  notes?: string | null,
  transportCompanyId?: string
): Promise<ReviewAvailabilityResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  const access = await resolveTransportCompanyId(
    actorId,
    session.user.role as UserRole,
    transportCompanyId
  );
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const effectiveTransportCompanyId = access.id;

  const availability = await prisma.driverAvailability.findUnique({
    where: { id: availabilityId },
    include: {
      dispatchWeek: { select: { transportCompanyId: true } },
      approval: true,
    },
  });

  if (!availability) {
    return { success: false, error: "Disponibilidade não encontrada." };
  }
  if (availability.dispatchWeek.transportCompanyId !== effectiveTransportCompanyId) {
    return { success: false, error: "Disponibilidade não pertence à transportadora selecionada." };
  }
  if (!availability.approval) {
    return { success: false, error: "Esta disponibilidade não está aguardando aprovação." };
  }

  await prisma.availabilityApproval.update({
    where: { id: availability.approval.id },
    data: {
      status,
      reviewerId: actorId,
      reviewedAt: new Date(),
      notes: notes?.trim() || null,
    },
  });

  await writeAuditLog({
    eventType: "AVAILABILITY_UPDATED",
    actorId,
    targetUserId: availability.userId,
    metadata: { driverAvailabilityId: availabilityId, action: status, notes: notes?.trim() || null },
  });

  revalidatePath("/disponibilidades");
  return { success: true };
}

export async function approveAvailability(
  availabilityId: string,
  notes?: string | null,
  transportCompanyId?: string
): Promise<ReviewAvailabilityResult> {
  return reviewAvailability(availabilityId, "APPROVED", notes, transportCompanyId);
}

export async function rejectAvailability(
  availabilityId: string,
  notes?: string | null,
  transportCompanyId?: string
): Promise<ReviewAvailabilityResult> {
  return reviewAvailability(availabilityId, "REJECTED", notes, transportCompanyId);
}
