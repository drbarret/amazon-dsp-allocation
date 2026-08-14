"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { roleIsAtLeast } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import type { UserRole } from "@/generated/prisma";

/**
 * Require SUPERVISOR or above. Throws if not authenticated or role too low.
 */
async function requireSupervisorOrAbove() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Não autenticado.");
  }
  if (!roleIsAtLeast(session.user.role as UserRole, "SUPERVISOR")) {
    throw new Error("Permissão insuficiente.");
  }
  return session;
}

/**
 * Set or clear the GNV (Natural Gas) vehicle restriction on a driver.
 *
 * Only SUPERVISOR, ACCOUNT_MANAGER, or ADMIN may call this.
 * A DRIVER cannot change this on themselves or anyone else post-onboarding.
 *
 * The GNV marking is allocation-relevant: GNV vehicles have reduced cargo
 * volume, which constrains which Amazon block the driver can be assigned to.
 */
export async function setDriverGnvMarking(
  targetUserId: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireSupervisorOrAbove();
  const actorId = session.user.id;

  // Find the target user and their driver profile
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      role: true,
      driverProfile: {
        select: {
          id: true,
          vehicleRestrictions: {
            where: {
              code: { in: ["GNV", "NATURAL_GAS"] },
            },
            select: { id: true, code: true },
          },
        },
      },
    },
  });

  if (!target) {
    return { success: false, error: "Usuário não encontrado." };
  }

  if (!target.driverProfile) {
    return { success: false, error: "Motorista não possui perfil de direção cadastrado." };
  }

  const profileId = target.driverProfile.id;
  const existingRestrictions = target.driverProfile.vehicleRestrictions;
  const hasGnv = existingRestrictions.length > 0;
  const beforeCodes = existingRestrictions.map((r) => r.code);

  if (enabled && hasGnv) {
    return { success: false, error: "GNV já está marcado para este motorista." };
  }

  if (!enabled && !hasGnv) {
    return { success: false, error: "GNV não está marcado para este motorista." };
  }

  if (enabled) {
    // Add GNV restriction (use GNV as canonical code; NATURAL_GAS is legacy)
    await prisma.vehicleRestriction.create({
      data: {
        driverProfileId: profileId,
        code: "GNV",
      },
    });
  } else {
    // Remove all GNV/NATURAL_GAS restrictions
    await prisma.vehicleRestriction.deleteMany({
      where: {
        driverProfileId: profileId,
        code: { in: ["GNV", "NATURAL_GAS"] },
      },
    });
  }

  // Read back the new state for the audit log
  const afterRestrictions = await prisma.vehicleRestriction.findMany({
    where: {
      driverProfileId: profileId,
      code: { in: ["GNV", "NATURAL_GAS"] },
    },
    select: { code: true },
  });
  const afterCodes = afterRestrictions.map((r) => r.code);

  await writeAuditLog({
    eventType: "VEHICLE_RESTRICTION_UPDATED",
    actorId,
    targetUserId,
    oldValue: { restrictions: beforeCodes },
    newValue: { restrictions: afterCodes },
    justification: enabled
      ? "GNV marcado por supervisor"
      : "GNV removido por supervisor",
  });

  revalidatePath("/drivers");
  return { success: true };
}
