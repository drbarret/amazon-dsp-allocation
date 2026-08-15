import { requireRole } from "@/lib/authz";
import { findExpiredCnhDrivers } from "@/lib/cnh-collection";
import { CnhCollectionClient } from "./client";

export const dynamic = "force-dynamic";

export default async function CnhCollectionPage() {
  const session = await requireRole("SUPERVISOR");
  const drivers = await findExpiredCnhDrivers();

  return (
    <CnhCollectionClient
      drivers={drivers.map((d) => ({
        driverProfileId: d.driverProfileId,
        userId: d.userId,
        name: d.name,
        email: d.email,
        cnhExpiration: d.cnhExpiration.toISOString(),
        lastCollectedAt: d.lastCollectedAt?.toISOString() ?? null,
      }))}
      currentUserId={session.user.id}
    />
  );
}
