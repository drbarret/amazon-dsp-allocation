"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { roleIsAtLeast } from "@/lib/authz";
import { sendCnhCollection } from "@/lib/cnh-collection";
import { revalidatePath } from "next/cache";
import type { UserRole } from "@/generated/prisma";

/**
 * Require an authenticated session with SUPERVISOR role or above.
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

export interface CollectCnhResult {
  success: boolean;
  /** Drivers actually emailed. */
  sent: number;
  /** Drivers skipped because the sender degraded (no RESEND_API_KEY). */
  degraded: number;
  /** Drivers that failed to send. */
  failed: { name: string; reason: string }[];
  /** Selected drivers refused by server-side validation (not emailed). */
  rejected: { name: string; reason: string }[];
}

/**
 * Supervisor (or above) charges the selected drivers for an updated CNH.
 *
 * The recipient list comes from the client, so it is NEVER trusted: each
 * selected user is revalidated on the server (role DRIVER, active, CNH
 * already expired) before any email is sent. Re-send is allowed — every send
 * is recorded as history with the actor.
 */
export async function collectCnh(userIds: string[]): Promise<CollectCnhResult> {
  const session = await requireSupervisorOrAbove();
  const actorId = session.user.id;

  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) {
    return { success: false, sent: 0, degraded: 0, failed: [], rejected: [] };
  }

  const now = new Date();

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      driverProfile: {
        select: { id: true, cnhExpiration: true },
      },
    },
  });

  const byId = new Map(users.map((u) => [u.id, u]));

  const valid: {
    driverProfileId: string;
    userId: string;
    name: string;
    email: string;
    cnhExpiration: Date;
  }[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const id of uniqueIds) {
    const u = byId.get(id);
    if (!u) {
      rejected.push({ name: id, reason: "Usuário não encontrado." });
      continue;
    }
    if (u.role !== "DRIVER" || !u.driverProfile) {
      rejected.push({ name: u.name, reason: "Não é um motorista com perfil cadastrado." });
      continue;
    }
    if (!u.active) {
      rejected.push({ name: u.name, reason: "Motorista inativo." });
      continue;
    }
    if (!u.driverProfile.cnhExpiration || u.driverProfile.cnhExpiration >= now) {
      rejected.push({ name: u.name, reason: "CNH não está vencida." });
      continue;
    }
    valid.push({
      driverProfileId: u.driverProfile.id,
      userId: u.id,
      name: u.name,
      email: u.email,
      cnhExpiration: u.driverProfile.cnhExpiration,
    });
  }

  const outcomes = await sendCnhCollection(valid, actorId);

  const sent = outcomes.filter((o) => o.status === "sent").length;
  const degraded = outcomes.filter((o) => o.status === "degraded").length;
  const failed = outcomes
    .filter((o) => o.status === "failed")
    .map((o) => {
      const u = byId.get(o.userId);
      return { name: u?.name ?? o.userId, reason: o.reason ?? "Falha ao enviar e-mail." };
    });

  // Audit the collection: actor + recipient count, no PII in the log.
  await writeAuditLog({
    eventType: "CNH_COLLECTED",
    actorId,
    metadata: {
      requested: uniqueIds.length,
      sent,
      degraded,
      failed: failed.length,
      rejected: rejected.length,
    },
  });

  revalidatePath("/admin/cnh");
  return { success: true, sent, degraded, failed, rejected };
}
