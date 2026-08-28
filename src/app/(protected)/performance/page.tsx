import { auth } from "@/lib/auth";
import { roleIsAtLeast } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getCurrentIsoWeek, getPreviousIsoWeek } from "@/lib/week-utils";
import { PerformanceClient } from "./client";
import type { UserRole } from "@/generated/prisma";

export const dynamic = "force-dynamic";

interface WeekOption {
  id: string;
  weekKey: string;
  year: number;
  weekNumber: number;
  startDate: string;
  endDate: string;
  transportCompanyId: string;
  status: string;
}

interface CompanyOption {
  id: string;
  name: string;
}

function formatDateBR(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default async function PerformancePage() {
  const session = await auth();
  const role = (session?.user?.role ?? "DRIVER") as UserRole;

  if (!roleIsAtLeast(role, "SUPERVISOR")) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <h1 className="text-heading text-2xl font-bold">Performance</h1>
        <p className="text-muted-foreground">
          Você não tem permissão para acessar esta página.
        </p>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session!.user!.id! },
    select: { transportCompanyId: true },
  });
  const hasTransportCompany = Boolean(user?.transportCompanyId);
  const effectiveCompanyId = user?.transportCompanyId ?? undefined;

  const companies: CompanyOption[] =
    roleIsAtLeast(role, "ACCOUNT_MANAGER") && !hasTransportCompany
      ? await prisma.transportCompany.findMany({
          where: { active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  const companyIds = hasTransportCompany
    ? [effectiveCompanyId as string]
    : companies.map((c) => c.id);

  const weeks = await prisma.dispatchWeek.findMany({
    where: {
      transportCompanyId: { in: companyIds },
    },
    orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
    select: {
      id: true,
      weekKey: true,
      year: true,
      weekNumber: true,
      startDate: true,
      endDate: true,
      transportCompanyId: true,
      status: true,
    },
  });

  const weekOptions: WeekOption[] = weeks.map((w) => ({
    id: w.id,
    weekKey: w.weekKey,
    year: w.year,
    weekNumber: w.weekNumber,
    startDate: formatDateBR(w.startDate),
    endDate: formatDateBR(w.endDate),
    transportCompanyId: w.transportCompanyId,
    status: w.status,
  }));

  const currentIsoWeek = getCurrentIsoWeek();
  const filteredWeekOptions = weekOptions.filter((w) => {
    if (w.year > currentIsoWeek.year) return false;
    if (w.year === currentIsoWeek.year && w.weekNumber >= currentIsoWeek.weekNumber)
      return false;
    return true;
  });

  const previousIsoWeek = getPreviousIsoWeek();
  const previousWeekId = filteredWeekOptions.find(
    (w) =>
      w.year === previousIsoWeek.year &&
      w.weekNumber === previousIsoWeek.weekNumber,
  )?.id;

  const initialWeekId = previousWeekId ?? filteredWeekOptions[0]?.id ?? "";

  return (
    <PerformanceClient
      weeks={filteredWeekOptions}
      initialWeekId={initialWeekId}
      hasTransportCompany={hasTransportCompany}
      companies={companies}
      userRole={role}
    />
  );
}
