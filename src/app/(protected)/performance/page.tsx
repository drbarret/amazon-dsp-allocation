import { auth } from "@/lib/auth";
import { roleIsAtLeast } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { PerformanceClient } from "./client";
import type { UserRole } from "@/generated/prisma";

export const dynamic = "force-dynamic";

interface WeekOption {
  id: string;
  weekKey: string;
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
      startDate: true,
      endDate: true,
      transportCompanyId: true,
      status: true,
    },
  });

  const weekOptions: WeekOption[] = weeks.map((w) => ({
    id: w.id,
    weekKey: w.weekKey,
    startDate: formatDateBR(w.startDate),
    endDate: formatDateBR(w.endDate),
    transportCompanyId: w.transportCompanyId,
    status: w.status,
  }));

  // Default to the most recent week for users with a company, or the first company's first week.
  const initialWeekId = hasTransportCompany
    ? (weekOptions.find((w) => w.transportCompanyId === effectiveCompanyId)
        ?.id ??
      weekOptions[0]?.id ??
      "")
    : (weekOptions[0]?.id ?? "");

  return (
    <PerformanceClient
      weeks={weekOptions}
      initialWeekId={initialWeekId}
      hasTransportCompany={hasTransportCompany}
      companies={companies}
      userRole={role}
    />
  );
}
