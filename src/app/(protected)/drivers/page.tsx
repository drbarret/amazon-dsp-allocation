import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { DriversClient } from "./client";
import { getPendingDeactivationCount } from "./actions";

export const dynamic = "force-dynamic";

export interface DriverRow {
  userId: string;
  name: string;
  email: string;
  vehicleType: string;
  hasGnv: boolean;
  onboardingCompleted: boolean;
  transporterId: string | null;
  worksCiclo1: boolean;
  worksCiclo2: boolean;
  isTrusted: boolean;
  whatsappGroup: string | null;
  phoneFormatted: string | null;
  cities: string[];
  active: boolean;
  deactivatedByRole: string | null;
}

export default async function DriversPage(props: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const session = await requireRole("SUPERVISOR");
  const searchParams = await props.searchParams;
  const statusFilter = searchParams?.status ?? "active";

  const whereClause: Record<string, unknown> = {
    role: "DRIVER",
    driverProfile: { isNot: null },
  };

  if (statusFilter === "active") {
    whereClause.active = true;
  } else if (statusFilter === "inactive") {
    whereClause.active = false;
  }
  // "all" → no active filter

  const drivers = await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      deactivatedByRole: true,
      driverProfile: {
        select: {
          vehicleType: true,
          onboardingCompleted: true,
          transporterId: true,
          worksCiclo1: true,
          worksCiclo2: true,
          isTrusted: true,
          whatsappGroup: true,
          phoneFormatted: true,
          vehicleRestrictions: {
            where: { code: { in: ["GNV", "NATURAL_GAS"] } },
            select: { code: true },
          },
          regionPreferences: {
            select: { city: true },
            orderBy: { priority: "asc" },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows: DriverRow[] = drivers.map((d) => ({
    userId: d.id,
    name: d.name,
    email: d.email,
    vehicleType: d.driverProfile?.vehicleType ?? "CARGO_VAN",
    hasGnv: (d.driverProfile?.vehicleRestrictions?.length ?? 0) > 0,
    onboardingCompleted: d.driverProfile?.onboardingCompleted ?? false,
    transporterId: d.driverProfile?.transporterId ?? null,
    worksCiclo1: d.driverProfile?.worksCiclo1 ?? false,
    worksCiclo2: d.driverProfile?.worksCiclo2 ?? false,
    isTrusted: d.driverProfile?.isTrusted ?? false,
    whatsappGroup: d.driverProfile?.whatsappGroup ?? null,
    phoneFormatted: d.driverProfile?.phoneFormatted ?? null,
    cities: d.driverProfile?.regionPreferences
      .filter((p) => p.city)
      .map((p) => p.city as string) ?? [],
    active: d.active,
    deactivatedByRole: d.deactivatedByRole,
  }));

  const pendingCount = await getPendingDeactivationCount();

  return (
    <DriversClient
      drivers={rows}
      pendingDeactivationCount={pendingCount}
      initialStatusFilter={statusFilter}
    />
  );
}
