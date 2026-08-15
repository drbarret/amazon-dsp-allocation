/**
 * CNH collection orchestration (manual, supervisor-driven).
 *
 * There is NO automatic trigger, schedule, or expiry window. The supervisor
 * deliberately selects which drivers to charge and clicks "Cobrar CNH
 * atualizada". This module only:
 *   1. Lists active drivers whose CNH is already expired (for the screen).
 *   2. Builds the collection email body.
 *   3. Sends to an already-validated set of drivers and records each send as
 *      a history row (re-send is allowed; every send is timestamped and
 *      attributed to the actor).
 *
 * The email sender is injectable so tests can run in simulated mode without
 * touching Resend or real driver addresses.
 */
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import type { EmailResult } from "@/lib/email";

export interface ExpiredCnhDriver {
  driverProfileId: string;
  userId: string;
  name: string;
  email: string;
  cnhExpiration: Date;
  /** When the last collection email was sent to this driver, if any. */
  lastCollectedAt: Date | null;
}

/**
 * Find active DRIVERs whose CNH is already expired (cnhExpiration < now),
 * with the most recent collection timestamp for each.
 */
export async function findExpiredCnhDrivers(
  now: Date = new Date(),
): Promise<ExpiredCnhDriver[]> {
  const profiles = await prisma.driverProfile.findMany({
    where: {
      cnhExpiration: { lt: now },
      user: { role: "DRIVER", active: true },
    },
    select: {
      id: true,
      cnhExpiration: true,
      user: { select: { id: true, name: true, email: true } },
      cnhReminders: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { sentAt: true },
      },
    },
    orderBy: { cnhExpiration: "asc" },
  });

  return profiles.map((p) => ({
    driverProfileId: p.id,
    userId: p.user.id,
    name: p.user.name,
    email: p.user.email,
    cnhExpiration: p.cnhExpiration!,
    lastCollectedAt: p.cnhReminders[0]?.sentAt ?? null,
  }));
}

/** Build the pt-BR collection email body. No unnecessary personal data. */
export function buildCollectionEmail(driver: {
  name: string;
  cnhExpiration: Date;
}): { subject: string; text: string } {
  const dateStr = driver.cnhExpiration.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const subject = "Cobrança de CNH atualizada";
  const text = [
    `Olá, ${driver.name},`,
    "",
    `Sua CNH está vencida desde ${dateStr}. Para continuar dirigindo sem ` +
      "interrupções, procure o seu supervisor e atualize a data de vencimento " +
      "da sua CNH o quanto antes.",
    "",
    "Atenciosamente,",
    "Equipe de Alocação",
  ].join("\n");
  return { subject, text };
}

export interface SendCnhCollectionOptions {
  /** Injectable sender. Defaults to the real sendEmail (Resend). */
  sendFn?: (opts: {
    to: string;
    subject: string;
    text: string;
  }) => Promise<EmailResult>;
}

export interface CnhCollectionOutcome {
  driverProfileId: string;
  userId: string;
  /** "sent" | "degraded" | "failed" */
  status: "sent" | "degraded" | "failed";
  reason?: string;
}

/** The fields needed to send a collection email to a driver. */
export type CnhCollectionRecipient = Pick<
  ExpiredCnhDriver,
  "driverProfileId" | "userId" | "name" | "email" | "cnhExpiration"
>;

/**
 * Send the collection email to each driver and record a history row per send.
 *
 * The caller is responsible for server-side validation (role, active, expired)
 * BEFORE calling this — the drivers passed here are assumed already validated.
 * Re-send is allowed: every successful send appends a new CnhReminder row.
 */
export async function sendCnhCollection(
  drivers: CnhCollectionRecipient[],
  actorId: string,
  options: SendCnhCollectionOptions = {},
): Promise<CnhCollectionOutcome[]> {
  const sendFn = options.sendFn ?? sendEmail;
  const outcomes: CnhCollectionOutcome[] = [];

  for (const driver of drivers) {
    const { subject, text } = buildCollectionEmail(driver);
    const emailResult = await sendFn({
      to: driver.email,
      subject,
      text,
    });

    if (emailResult.degraded) {
      // No RESEND_API_KEY — degrade clearly, do not record as sent.
      outcomes.push({
        driverProfileId: driver.driverProfileId,
        userId: driver.userId,
        status: "degraded",
      });
      continue;
    }
    if (!emailResult.sent) {
      outcomes.push({
        driverProfileId: driver.driverProfileId,
        userId: driver.userId,
        status: "failed",
        reason: emailResult.error ?? "Falha ao enviar e-mail.",
      });
      continue;
    }

    // Record the collection as history (re-send allowed — no unique guard).
    await prisma.cnhReminder.create({
      data: {
        driverProfileId: driver.driverProfileId,
        cnhExpiration: driver.cnhExpiration,
        type: "CNH_COLLECTED",
        actorId,
      },
    });
    outcomes.push({
      driverProfileId: driver.driverProfileId,
      userId: driver.userId,
      status: "sent",
    });
  }

  return outcomes;
}
