import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { DisponibilidadesClient } from "./client";
import type { UserRole } from "@/generated/prisma";

export const dynamic = "force-dynamic";

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR");
}

function defaultWeekId(weeks: { id: string; startDate: Date; endDate: Date }[]): string {
  const now = new Date();
  const next = weeks.find((w) => new Date(w.startDate) >= now);
  return next?.id ?? weeks[0]?.id ?? "";
}

const MANAGEMENT_ROLES: UserRole[] = ["ADMIN", "ACCOUNT_MANAGER"];

export default async function DisponibilidadesPage() {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;
  const role = (session.user.role as UserRole) ?? "DRIVER";
  const canManageAllCompanies = MANAGEMENT_ROLES.includes(role);

  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { transportCompanyId: true },
  });

  const ownTransportCompanyId = user?.transportCompanyId ?? null;
  const hasTransportCompany = ownTransportCompanyId !== null;

  const effectiveTransportCompanyId = ownTransportCompanyId ?? undefined;
  const shouldLoadAllCompanies = !hasTransportCompany && canManageAllCompanies;

  const [companies, weeks] = await Promise.all([
    shouldLoadAllCompanies
      ? prisma.transportCompany.findMany({
          where: { active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    effectiveTransportCompanyId
      ? prisma.dispatchWeek.findMany({
          where: { transportCompanyId: effectiveTransportCompanyId },
          orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
        })
      : prisma.dispatchWeek.findMany({
          orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
        }),
  ]);

  return (
    <DisponibilidadesClient
      weeks={weeks.map((w) => ({
        id: w.id,
        weekKey: w.weekKey,
        startDate: formatDate(w.startDate),
        endDate: formatDate(w.endDate),
        transportCompanyId: w.transportCompanyId,
      }))}
      initialWeekId={defaultWeekId(weeks)}
      hasTransportCompany={hasTransportCompany}
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
      userRole={role}
    />
  );
}
