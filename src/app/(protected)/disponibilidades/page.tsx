import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { DisponibilidadesClient } from "./client";

export const dynamic = "force-dynamic";

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR");
}

function defaultWeekId(weeks: { id: string; startDate: Date; endDate: Date }[]): string {
  const now = new Date();
  const next = weeks.find((w) => new Date(w.startDate) >= now);
  return next?.id ?? weeks[0]?.id ?? "";
}

export default async function DisponibilidadesPage() {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { transportCompanyId: true },
  });

  const transportCompanyId = user?.transportCompanyId ?? null;

  const weeks = transportCompanyId
    ? await prisma.dispatchWeek.findMany({
        where: { transportCompanyId },
        orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
      })
    : [];

  return (
    <DisponibilidadesClient
      weeks={weeks.map((w) => ({
        id: w.id,
        weekKey: w.weekKey,
        startDate: formatDate(w.startDate),
        endDate: formatDate(w.endDate),
      }))}
      initialWeekId={defaultWeekId(weeks)}
      hasTransportCompany={transportCompanyId !== null}
    />
  );
}
