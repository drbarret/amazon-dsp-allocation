/**
 * Pure behavior/punishment rules for driver infractions.
 *
 * This module has NO side effects (no DB, no auth). It encodes the user's
 * rules from docs/plans/driver-behavior-and-allocation-rules.md §3 so they can
 * be unit-tested against the real production code paths.
 *
 * Key rules encoded here:
 *   - The punishment is determined by the TYPE, never by the supervisor.
 *   - RECLAMACAO_ASPERA (subjective) requires account-manager approval; the
 *     other 4 types are active immediately.
 *   - The punishment applies the week AFTER the mark.
 *   - "Perde N vagas" is only fulfilled when the driver actually receives at
 *     least one vacancy in the effective week; otherwise it stays pending and
 *     rolls to the next week (it never expires on its own).
 *   - "N semanas sem vagas" is fulfilled after the driver is excluded for
 *     `multiplier` consecutive effective weeks.
 *   - Recidivism (a new mark while a punishment is ACTIVE or within
 *     RECIDIVISM_WINDOW_WEEKS after fulfillment) doubles the punishment and
 *     triggers a supervisor warning; if the supervisor does not deactivate
 *     within ESCALATION_DAYS, the account managers are notified.
 */
import type { InfractionType } from "@/generated/prisma";

/** Punishment kinds derived from the infraction type. */
export type PunishmentKind = "LOSE_VACANCY" | "NO_VACANCIES_WEEK";

export interface InfractionTypeRule {
  type: InfractionType;
  /** Human-readable pt-BR label. */
  label: string;
  /** Whether this type requires account-manager approval before it becomes a punishment. */
  requiresApproval: boolean;
  /** The punishment kind. */
  punishment: PunishmentKind;
  /** Base number of vacancies lost (LOSE_VACANCY) or weeks excluded (NO_VACANCIES_WEEK). */
  baseSeverity: number;
}

/**
 * The 5 infraction types. The punishment is fixed per type — the supervisor
 * only chooses WHICH infraction occurred, never the severity.
 */
export const INFRACTION_TYPES: Record<InfractionType, InfractionTypeRule> = {
  NAO_REVERTER_INSUCESSOS: {
    type: "NAO_REVERTER_INSUCESSOS",
    label: "Não reverter insucessos no fim da rota",
    requiresApproval: false,
    punishment: "LOSE_VACANCY",
    baseSeverity: 1,
  },
  RECLAMACAO_ASPERA: {
    type: "RECLAMACAO_ASPERA",
    label: "Reclamação áspera (incomoda supervisores)",
    requiresApproval: true,
    punishment: "LOSE_VACANCY",
    baseSeverity: 1,
  },
  FALTAS_RECORRENTES: {
    type: "FALTAS_RECORRENTES",
    label: "Faltas recorrentes sem justificativa",
    requiresApproval: false,
    punishment: "LOSE_VACANCY",
    baseSeverity: 1,
  },
  ABANDONO_ROTA: {
    type: "ABANDONO_ROTA",
    label: "Deixar a rota no chão durante o dispatch",
    requiresApproval: false,
    punishment: "NO_VACANCIES_WEEK",
    baseSeverity: 1,
  },
  DESCUMPRIR_REGRAS_AMAZON: {
    type: "DESCUMPRIR_REGRAS_AMAZON",
    label: "Não cumprir as regras da Amazon",
    requiresApproval: false,
    punishment: "LOSE_VACANCY",
    baseSeverity: 1,
  },
};

export const INFRACTION_TYPE_LIST: InfractionTypeRule[] = Object.values(INFRACTION_TYPES);

export function getInfractionRule(type: InfractionType): InfractionTypeRule {
  return INFRACTION_TYPES[type];
}

/**
 * Recidivism window: a new mark counts as recidivism if it happens while a
 * previous punishment is still ACTIVE, or within this many weeks after the
 * previous punishment was FULFILLED.
 *
 * Justification: 4 weeks (~1 month) captures "logo após zerar" — a driver who
 * re-offends within a month of completing a punishment is showing a pattern,
 * not an isolated lapse. Longer windows would punish drivers for unrelated
 * one-off mistakes months later; shorter windows would miss genuine repeat
 * offenders who space out their infractions.
 */
export const RECIDIVISM_WINDOW_WEEKS = 4;

/**
 * Escalation deadline: after a recidivism warning is sent to the supervisor,
 * if the supervisor has not deactivated the driver within this many days, the
 * account managers are notified.
 *
 * Justification: 7 days gives the supervisor a full business week to review
 * the case and act, while not leaving a repeat offender unaddressed for too
 * long. It is long enough to be fair, short enough to escalate promptly.
 */
export const ESCALATION_DAYS = 7;

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Add `weeks` weeks to a date (keeps the same weekday). */
export function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * 7 * DAY_MS);
}

/** Add `days` days to a date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Compute the effective week (the week AFTER the marked week) as a date range.
 * The marked week is identified by its start/end dates.
 */
export function computeEffectiveWeek(markedWeekStart: Date, markedWeekEnd: Date): {
  start: Date;
  end: Date;
} {
  return {
    start: addDays(markedWeekEnd, 1),
    end: addDays(markedWeekEnd, 7),
  };
}

/**
 * Compute the punishment magnitude for a mark, applying the recidivism
 * multiplier. `isRecidivism` is determined by the caller (see
 * `isRecidivismMark`).
 */
export function computeMultiplier(isRecidivism: boolean): number {
  return isRecidivism ? 2 : 1;
}

/**
 * Whether a new mark for a driver counts as recidivism, given the driver's
 * most recent infraction history.
 *
 * @param hasActivePunishment true if the driver has an ACTIVE (or PENDING_APPROVAL) infraction.
 * @param lastFulfilledAt the fulfillment date of the most recent fulfilled infraction, if any.
 * @param now the current time.
 */
export function isRecidivismMark(
  hasActivePunishment: boolean,
  lastFulfilledAt: Date | null,
  now: Date
): boolean {
  if (hasActivePunishment) return true;
  if (!lastFulfilledAt) return false;
  const windowMs = RECIDIVISM_WINDOW_WEEKS * 7 * DAY_MS;
  return now.getTime() - lastFulfilledAt.getTime() <= windowMs;
}

/**
 * Whether a recidivism warning should be escalated to the account managers.
 * Escalation happens when the supervisor was notified but has not deactivated
 * the driver within ESCALATION_DAYS.
 */
export function isEscalationDue(
  supervisorNotifiedAt: Date | null,
  now: Date
): boolean {
  if (!supervisorNotifiedAt) return false;
  return now.getTime() - supervisorNotifiedAt.getTime() >= ESCALATION_DAYS * DAY_MS;
}

/**
 * Whether a LOSE_VACANCY punishment is fulfilled in a given week.
 *
 * The rule: the punishment is only fulfilled when the driver actually loses a
 * vacancy. If the driver received NO vacancy in the effective week, the
 * punishment stays pending (it does not expire with the week).
 */
export function isLoseVacancyFulfilled(assignedCount: number): boolean {
  return assignedCount >= 1;
}

/**
 * Whether a NO_VACANCIES_WEEK punishment is fulfilled after serving a week.
 * It is fulfilled once the driver has been excluded for `multiplier` weeks.
 */
export function isNoVacanciesWeekFulfilled(weeksServed: number, multiplier: number): boolean {
  return weeksServed >= multiplier;
}

/**
 * Human-readable description of the punishment for a given type and multiplier.
 */
export function describePunishment(type: InfractionType, multiplier: number): string {
  const rule = getInfractionRule(type);
  if (rule.punishment === "NO_VACANCIES_WEEK") {
    const weeks = rule.baseSeverity * multiplier;
    return weeks === 1 ? "1 semana sem vagas" : `${weeks} semanas sem vagas`;
  }
  const vacancies = rule.baseSeverity * multiplier;
  return vacancies === 1 ? "perde 1 vaga" : `perde ${vacancies} vagas`;
}
