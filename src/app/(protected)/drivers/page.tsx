import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { DriversClient } from "./client";

export const dynamic = "force-dynamic";

export interface DriverRow {
  userId: string;
  name: string;
  email: string;
  vehicleType: string;
  hasGnv: boolean;
  onboardingCompleted: boolean;
}

export default async function DriversPage() {
  await requireRole("SUPERVISOR");

  const drivers = await prisma.user.findMany({
    where: {
      role: "DRIVER",
      active: true,
      driverProfile: { isNot: null },
    },
    select: {
      id: true,
      name: true,
      email: true,
      driverProfile: {
        select: {
          vehicleType: true,
          onboardingCompleted: true,
          vehicleRestrictions: {
            where: {
              code: { in: ["GNV", "NATURAL_GAS"] },
            },
            select: { code: true },
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
  }));

  return (
    <DriversClient drivers={rows} />
  );
}
