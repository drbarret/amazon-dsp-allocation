import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { BehaviorClient } from "./client";
import { INFRACTION_TYPE_LIST } from "@/lib/behavior";
import type { InfractionType } from "@/generated/prisma";

export const dynamic = "force-dynamic";

export interface BehaviorDriverRow {
  driverProfileId: string;
  userId: string;
  name: string;
  email: string;
}

export interface BehaviorWeekRow {
  id: string;
  weekKey: string;
  startDate: string;
  endDate: string;
}

export default async function BehaviorPage() {
  const session = await requireRole("SUPERVISOR");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { transportCompanyId: true },
  });
  const transportCompanyId = user?.transportCompanyId ?? null;

  const drivers: BehaviorDriverRow[] = transportCompanyId
    ? await prisma.user.findMany({
        where: {
          role: "DRIVER",
          active: true,
          transportCompanyId,
          driverProfile: { isNot: null },
        },
        select: {
          id: true,
          name: true,
          email: true,
          driverProfile: { select: { id: true } },
        },
        orderBy: { name: "asc" },
      }).then((rows) =>
        rows.map((r) => ({
          driverProfileId: r.driverProfile!.id,
          userId: r.id,
          name: r.name,
          email: r.email,
        }))
      )
    : [];

  const weeks = transportCompanyId
    ? await prisma.dispatchWeek.findMany({
        where: { transportCompanyId },
        select: { id: true, weekKey: true, startDate: true, endDate: true },
        orderBy: { startDate: "desc" },
        take: 8,
      })
    : [];

  const weekRows: BehaviorWeekRow[] = weeks.map((w) => ({
    id: w.id,
    weekKey: w.weekKey,
    startDate: w.startDate.toISOString().split("T")[0],
    endDate: w.endDate.toISOString().split("T")[0],
  }));

  return (
    <BehaviorClient
      drivers={drivers}
      weeks={weekRows}
      infractionTypes={INFRACTION_TYPE_LIST.map((r) => ({
        type: r.type as InfractionType,
        label: r.label,
        requiresApproval: r.requiresApproval,
        punishment: describe(r),
      }))}
    />
  );
}

function describe(r: { type: InfractionType; punishment: string; baseSeverity: number }) {
  return r.punishment === "NO_VACANCIES_WEEK"
    ? "1 semana sem vagas"
    : "perde 1 vaga";
}
