import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma";

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Cancel all PENDING deactivation requests for a driver.
 * Called when a driver is deactivated/reactivated through another path
 * (e.g., /admin/users or direct AM deactivation on /drivers).
 * This prevents orphaned pending requests.
 *
 * Can be called with an optional transaction client for atomicity.
 *
 * IMPORTANT: This function is intentionally NOT exported from any "use server"
 * module. It receives a Prisma transaction client which is not serializable
 * via the RSC wire protocol. If placed in a "use server" file, Next.js would
 * treat it as a Server Action and fail to pass the tx argument in production.
 */
export async function cancelPendingDeactivationRequests(
  driverUserId: string,
  actorId: string,
  reason: string,
  tx?: TransactionClient,
): Promise<void> {
  const db = tx ?? prisma;

  const pendingRequests = await db.deactivationRequest.findMany({
    where: { driverUserId, status: "PENDING" },
    select: { id: true },
  });

  if (pendingRequests.length === 0) return;

  await db.deactivationRequest.updateMany({
    where: { driverUserId, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewedAt: new Date(),
      reviewNotes: reason,
    },
  });

  // Audit each cancellation (only outside transaction to avoid nested issues)
  if (!tx) {
    for (const req of pendingRequests) {
      await writeAuditLog({
        eventType: "DEACTIVATION_REQUEST_CANCELLED",
        actorId,
        targetUserId: driverUserId,
        metadata: { requestId: req.id, reason },
      });
    }
  }
}
