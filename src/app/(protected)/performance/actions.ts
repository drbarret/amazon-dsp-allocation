"use server";

import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  parsePerformanceFile,
  type PerformanceParseError,
} from "@/lib/performance/csv-parser";
import { revalidatePath } from "next/cache";
import type {
  UserRole,
  ScorecardClassification,
  Prisma,
} from "@/generated/prisma";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const MANAGEMENT_ROLES: UserRole[] = ["ADMIN", "ACCOUNT_MANAGER"];

export interface ImportPerformanceResult {
  success: boolean;
  weekKey: string;
  imported: number;
  skipped: number;
  errors: PerformanceParseError[];
  error?: string;
}

export interface PerformanceSnapshotRow {
  id: string;
  name: string;
  transporterId: string;
  scoreText: string | null;
  deliveredPackages: number;
  dcr: number;
  dnr: number;
  insucessos: number;
  contactCompliance: number;
  swipeToFinishCompliance: number;
  whc100: boolean;
  classification: ScorecardClassification;
}

function sanitizeString(value: unknown, maxLength = 255): string | null {
  const str = String(value ?? "").trim();
  if (str === "") return null;
  return str.slice(0, maxLength);
}

async function resolveTransportCompanyId(
  actorId: string,
  actorRole: UserRole,
  requestedTransportCompanyId?: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { transportCompanyId: true },
  });

  const ownTransportCompanyId = user?.transportCompanyId ?? null;

  if (ownTransportCompanyId) {
    if (
      requestedTransportCompanyId &&
      requestedTransportCompanyId !== ownTransportCompanyId
    ) {
      return {
        ok: false,
        error: "Sem permissão para acessar outra transportadora.",
      };
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

export async function importPerformanceCsv(
  formData: FormData,
): Promise<ImportPerformanceResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  const weekRaw = sanitizeString(formData.get("week"));
  if (!weekRaw) {
    return {
      success: false,
      weekKey: "",
      imported: 0,
      skipped: 0,
      errors: [],
      error: "Semana não informada.",
    };
  }
  const weekKey = weekRaw.toUpperCase().startsWith("WK-")
    ? weekRaw.toUpperCase()
    : `WK-${weekRaw}`;

  const dispatchWeekId = sanitizeString(formData.get("dispatchWeekId"));
  const transportCompanyId =
    sanitizeString(formData.get("transportCompanyId")) ?? undefined;

  const access = await resolveTransportCompanyId(
    actorId,
    actorRole,
    transportCompanyId,
  );
  if (!access.ok) {
    return {
      success: false,
      weekKey,
      imported: 0,
      skipped: 0,
      errors: [],
      error: access.error,
    };
  }
  const effectiveTransportCompanyId = access.id;

  const file = formData.get("file");
  if (!file || !(file instanceof Blob) || file.size === 0) {
    return {
      success: false,
      weekKey,
      imported: 0,
      skipped: 0,
      errors: [],
      error: "Arquivo não enviado.",
    };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      success: false,
      weekKey,
      imported: 0,
      skipped: 0,
      errors: [],
      error: "Arquivo excede o limite de 5MB.",
    };
  }

  let dispatchWeek: {
    id: string;
    transportCompanyId: string;
    weekKey: string;
    year: number;
    weekNumber: number;
  } | null = null;

  if (dispatchWeekId) {
    dispatchWeek = await prisma.dispatchWeek.findUnique({
      where: { id: dispatchWeekId },
      select: {
        id: true,
        transportCompanyId: true,
        weekKey: true,
        year: true,
        weekNumber: true,
      },
    });
  } else {
    dispatchWeek = await prisma.dispatchWeek.findFirst({
      where: { weekKey, transportCompanyId: effectiveTransportCompanyId },
      select: {
        id: true,
        transportCompanyId: true,
        weekKey: true,
        year: true,
        weekNumber: true,
      },
    });
  }

  if (!dispatchWeek) {
    return {
      success: false,
      weekKey,
      imported: 0,
      skipped: 0,
      errors: [],
      error: "Semana não encontrada. Crie a semana antes de importar.",
    };
  }
  if (dispatchWeek.transportCompanyId !== effectiveTransportCompanyId) {
    return {
      success: false,
      weekKey,
      imported: 0,
      skipped: 0,
      errors: [],
      error: "Semana não pertence à transportadora selecionada.",
    };
  }

  const fileName = (file as File).name || "performance.xlsx";
  const arrayBuffer = await file.arrayBuffer();
  const parseResult = parsePerformanceFile(arrayBuffer, fileName);

  const errors: PerformanceParseError[] = [...parseResult.errors];
  let imported = 0;
  let skipped = 0;

  const performanceImport = await prisma.performanceImport.create({
    data: {
      dispatchWeekId: dispatchWeek.id,
      weekKey: dispatchWeek.weekKey,
      year: dispatchWeek.year,
      weekNumber: dispatchWeek.weekNumber,
      transportCompanyId: effectiveTransportCompanyId,
      fileName,
      importedById: actorId,
      status: "PROCESSING",
    },
  });

  // Pre-fetch active drivers by transporterId for the selected company.
  const transporterIds = parseResult.rows.map((r) => r.transporterId);
  const drivers = await prisma.driverProfile.findMany({
    where: {
      transporterId: { in: transporterIds },
      user: { transportCompanyId: effectiveTransportCompanyId, active: true },
    },
    select: {
      id: true,
      transporterId: true,
      userId: true,
      user: { select: { name: true } },
    },
  });
  const driverByTransporterId = new Map(
    drivers.map((d) => [d.transporterId as string, d]),
  );

  await prisma.$transaction(
    async (tx) => {
      for (const row of parseResult.rows) {
        const driver = driverByTransporterId.get(row.transporterId);
        if (!driver) {
          skipped++;
          errors.push({
            row: row.row,
            reason: `Motorista ativo com Transporter ID "${row.transporterId}" não encontrado nesta transportadora.`,
          });
          continue;
        }

        await tx.driverPerformanceSnapshot.create({
          data: {
            performanceImportId: performanceImport.id,
            driverProfileId: driver.id,
            transporterId: row.transporterId,
            name: row.name || driver.user?.name || row.transporterId,
            scoreText: row.scoreText,
            deliveredPackages: row.deliveredPackages,
            dcr: row.dcr,
            dnr: row.dnr,
            insucessos: row.insucessos,
            contactCompliance: row.contactCompliance,
            swipeToFinishCompliance: row.swipeToFinishCompliance,
            whc100: row.whc100,
            classification: row.classification,
          },
        });

        imported++;
      }

      const finalStatus =
        imported === 0 && errors.length > 0 ? "FAILED" : "COMPLETED";
      await tx.performanceImport.update({
        where: { id: performanceImport.id },
        data: {
          status: finalStatus,
          errors:
            errors.length > 0
              ? (errors as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      });
    },
    { timeout: 30000 },
  );

  await writeAuditLog({
    eventType: "SCORECARD_IMPORTED",
    actorId,
    metadata: {
      performanceImportId: performanceImport.id,
      dispatchWeekId: dispatchWeek.id,
      weekKey,
      imported,
      skipped,
      errors: errors.length,
    },
  });

  revalidatePath("/performance");

  return {
    success: errors.length === 0,
    weekKey,
    imported,
    skipped,
    errors,
  };
}

export interface ListPerformanceSnapshotsResult {
  success: boolean;
  error?: string;
  rows: PerformanceSnapshotRow[];
}

export async function listPerformanceSnapshots(
  dispatchWeekId: string,
  transportCompanyId?: string,
): Promise<ListPerformanceSnapshotsResult> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  const access = await resolveTransportCompanyId(
    actorId,
    actorRole,
    transportCompanyId,
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
    return {
      success: false,
      error: "Semana não pertence à transportadora selecionada.",
      rows: [],
    };
  }

  const snapshots = await prisma.driverPerformanceSnapshot.findMany({
    where: { performanceImport: { dispatchWeekId } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      transporterId: true,
      scoreText: true,
      deliveredPackages: true,
      dcr: true,
      dnr: true,
      insucessos: true,
      contactCompliance: true,
      swipeToFinishCompliance: true,
      whc100: true,
      classification: true,
    },
  });

  return { success: true, rows: snapshots };
}

export async function clearPerformanceWeek(
  dispatchWeekId: string,
  transportCompanyId?: string,
): Promise<{ success: boolean; deleted: number; error?: string }> {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;
  const actorRole = session.user.role as UserRole;

  const access = await resolveTransportCompanyId(
    actorId,
    actorRole,
    transportCompanyId,
  );
  if (!access.ok) {
    return { success: false, deleted: 0, error: access.error };
  }
  const effectiveTransportCompanyId = access.id;

  const week = await prisma.dispatchWeek.findUnique({
    where: { id: dispatchWeekId },
    select: { transportCompanyId: true, weekKey: true },
  });
  if (!week) {
    return { success: false, deleted: 0, error: "Semana não encontrada." };
  }
  if (week.transportCompanyId !== effectiveTransportCompanyId) {
    return {
      success: false,
      deleted: 0,
      error: "Semana não pertence à transportadora selecionada.",
    };
  }

  const result = await prisma.performanceImport.deleteMany({
    where: { dispatchWeekId, transportCompanyId: effectiveTransportCompanyId },
  });

  await writeAuditLog({
    eventType: "SCORECARD_IMPORTED",
    actorId,
    metadata: {
      dispatchWeekId,
      weekKey: week.weekKey,
      deleted: result.count,
      action: "CLEAR_WEEK",
    },
  });

  revalidatePath("/performance");
  return { success: true, deleted: result.count };
}
