/**
 * CNH expiry reminder orchestration.
 *
 * Finds active drivers whose CNH expires within a window (default 30 days)
 * and sends them a reminder email. Idempotency is enforced two ways:
 *   1. A `CnhReminder` row is recorded per (driverProfileId, cnhExpiration)
 *      and checked before sending.
 *   2. A unique (driverProfileId, cnhExpiration) constraint in the DB makes
 *      a duplicate insert fail, so the same reminder can never be sent twice.
 *
 * The email sender is injectable so tests can run in simulated mode without
 * touching Resend or real driver addresses.
 */
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import type { EmailResult } from "@/lib/email";

/** Default reminder window: 30 days before expiry. */
export const REMINDER_WINDOW_DAYS = 30;

export interface CnhReminderDriver {
  driverProfileId: string;
  userId: string;
  name: string;
  email: string;
  cnhExpiration: Date;
}

export interface SendCnhRemindersOptions {
  /** Reference "now". Defaults to new Date(). Injectable for tests. */
  now?: Date;
  /** When true, log what would be sent but do not send or record. */
  dryRun?: boolean;
  /** Injectable sender. Defaults to the real sendEmail (Resend). */
  sendFn?: (opts: {
    to: string;
    subject: string;
    text: string;
  }) => Promise<EmailResult>;
}

export interface SendCnhRemindersResult {
  /** Drivers that were due for a reminder in this run. */
  due: CnhReminderDriver[];
  /** Drivers actually emailed (or would be, in dry-run). */
  sent: CnhReminderDriver[];
  /** Drivers skipped because they were already reminded for this expiry. */
  alreadyReminded: CnhReminderDriver[];
  /** Drivers skipped because the sender degraded (no RESEND_API_KEY). */
  degraded: CnhReminderDriver[];
  /** Drivers that failed to send. */
  failed: CnhReminderDriver[];
}

/**
 * Find active drivers whose CNH expires within `days` days from `now` and
 * who have NOT already been reminded for that exact expiry date.
 */
export async function findDriversExpiringWithin(
  days: number,
  now: Date = new Date(),
): Promise<CnhReminderDriver[]> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const profiles = await prisma.driverProfile.findMany({
    where: {
      cnhExpiration: { gte: start, lt: end },
      user: { role: "DRIVER", active: true },
    },
    select: {
      id: true,
      cnhExpiration: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return profiles.map((p) => ({
    driverProfileId: p.id,
    userId: p.user.id,
    name: p.user.name,
    email: p.user.email,
    cnhExpiration: p.cnhExpiration!,
  }));
}

/** Build the pt-BR reminder email body. No unnecessary personal data. */
export function buildReminderEmail(driver: CnhReminderDriver): {
  subject: string;
  text: string;
} {
  const dateStr = driver.cnhExpiration.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const subject = "Sua CNH vai vencer em breve";
  const text = [
    `Olá, ${driver.name},`,
    "",
    `Sua CNH vence em ${dateStr}. Para continuar dirigindo sem interrupções, ` +
      "procure o seu supervisor e atualize a data de vencimento da sua CNH.",
    "",
    "Atenciosamente,",
    "Equipe de Alocação",
  ].join("\n");
  return { subject, text };
}

/**
 * Send CNH expiry reminders to all due drivers.
 *
 * Idempotent: a driver already reminded for a given expiry date is skipped.
 * In dry-run mode nothing is sent or recorded.
 */
export async function sendCnhReminders(
  options: SendCnhRemindersOptions = {},
): Promise<SendCnhRemindersResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const sendFn = options.sendFn ?? sendEmail;

  const due = await findDriversExpiringWithin(REMINDER_WINDOW_DAYS, now);

  const result: SendCnhRemindersResult = {
    due,
    sent: [],
    alreadyReminded: [],
    degraded: [],
    failed: [],
  };

  for (const driver of due) {
    // Idempotency check: already reminded for this exact expiry date?
    const existing = await prisma.cnhReminder.findUnique({
      where: {
        driverProfileId_cnhExpiration: {
          driverProfileId: driver.driverProfileId,
          cnhExpiration: driver.cnhExpiration,
        },
      },
    });
    if (existing) {
      result.alreadyReminded.push(driver);
      continue;
    }

    if (dryRun) {
      console.log(
        `[cnh-reminder][dry-run] Enviaria aviso para ${driver.email} (CNH ${driver.cnhExpiration.toISOString()})`,
      );
      result.sent.push(driver);
      continue;
    }

    const { subject, text } = buildReminderEmail(driver);
    const emailResult = await sendFn({
      to: driver.email,
      subject,
      text,
    });

    if (emailResult.degraded) {
      // No RESEND_API_KEY — degrade clearly, do not record as sent.
      result.degraded.push(driver);
      continue;
    }
    if (!emailResult.sent) {
      result.failed.push(driver);
      continue;
    }

    // Record the reminder (unique constraint guards against races).
    try {
      await prisma.cnhReminder.create({
        data: {
          driverProfileId: driver.driverProfileId,
          cnhExpiration: driver.cnhExpiration,
          type: "CNH_EXPIRY_30D",
        },
      });
      result.sent.push(driver);
    } catch (err) {
      // Unique constraint hit → another run already recorded it. Treat as
      // already reminded (idempotent), not a failure.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Unique constraint")) {
        result.alreadyReminded.push(driver);
      } else {
        result.failed.push(driver);
      }
    }
  }

  return result;
}
