import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { DispatchClient } from "./client";

export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  const session = await requireRole("SUPERVISOR");
  const actorId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { transportCompanyId: true },
  });

  const transportCompanyId = user?.transportCompanyId ?? null;

  const [weeks, drivers] = await Promise.all([
    transportCompanyId
      ? prisma.dispatchWeek.findMany({
          where: { transportCompanyId },
          orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
        })
      : Promise.resolve([]),
    transportCompanyId
      ? prisma.user.findMany({
          where: {
            transportCompanyId,
            role: "DRIVER",
            active: true,
          },
          select: {
            id: true,
            name: true,
            email: true,
            driverProfile: {
              select: {
                id: true,
                vehicleType: true,
                onboardingCompleted: true,
              },
            },
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <DispatchClient
      weeks={weeks}
      drivers={drivers}
      hasTransportCompany={transportCompanyId !== null}
    />
  );
}
