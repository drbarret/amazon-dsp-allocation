import { prisma } from "@/lib/prisma";
import type { AuditEventType } from "@/generated/prisma";
import type { Prisma } from "@/generated/prisma";

interface AuditEntry {
  eventType: AuditEventType;
  actorId?: string | null;
  targetUserId?: string | null;
  scheduleId?: string | null;
  allocationRunId?: string | null;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  justification?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Write an audit log entry. All fields except eventType are optional.
 * Never stores CPF, tokens, or raw personal data in metadata.
 */
export async function writeAuditLog(entry: AuditEntry) {
  await prisma.auditLog.create({
    data: {
      eventType: entry.eventType,
      actorId: entry.actorId ?? null,
      targetUserId: entry.targetUserId ?? null,
      scheduleId: entry.scheduleId ?? null,
      allocationRunId: entry.allocationRunId ?? null,
      oldValue: entry.oldValue ?? undefined,
      newValue: entry.newValue ?? undefined,
      justification: entry.justification ?? null,
      metadata: entry.metadata ?? undefined,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}
