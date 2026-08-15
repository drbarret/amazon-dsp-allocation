/**
 * Integration between the distribution engine and the behavior punishments.
 *
 * This module is pure (no DB, no auth) so the punishment application and the
 * fulfillment/roll-forward logic can be unit-tested against the real
 * production code paths. `runDistribution` in dispatch/actions.ts calls these
 * helpers and persists the resulting state.
 */
import type { DriverInfraction } from "@/generated/prisma";
import { getInfractionRule, addWeeks, isLoseVacancyFulfilled, isNoVacanciesWeekFulfilled } from "@/lib/behavior";

/** How a punishment affects a driver in the engine. */
export interface PunishmentEffect {
  quotaReduction: number;
  excluded: boolean;
}

/**
 * Map each ACTIVE infraction to the effect it has on its driver for the week
 * being distributed. Multiple infractions for the same driver are summed.
 */
export function applyPunishmentsToDrivers(
  infractions: Pick<DriverInfraction, "driverProfileId" | "type" | "multiplier">[]
): Map<string, PunishmentEffect> {
  const effects = new Map<string, PunishmentEffect>();
  for (const inf of infractions) {
    const rule = getInfractionRule(inf.type);
    const current = effects.get(inf.driverProfileId) ?? { quotaReduction: 0, excluded: false };
    if (rule.punishment === "NO_VACANCIES_WEEK") {
      current.excluded = true;
    } else {
      current.quotaReduction += rule.baseSeverity * inf.multiplier;
    }
    effects.set(inf.driverProfileId, current);
  }
  return effects;
}

export interface PunishmentOutcome {
  infractionId: string;
  /** true = mark FULFILLED; false = roll forward to the next week. */
  fulfilled: boolean;
  /** Next effective week dates (only when rolling forward). */
  nextStart?: Date;
  nextEnd?: Date;
  /** New weeksServed value (only for NO_VACANCIES_WEEK when rolling forward). */
  nextWeeksServed?: number;
}

/**
 * Resolve the outcome of each ACTIVE infraction whose effective week is the
 * week being distributed, given how many vacancies each driver actually
 * received.
 *
 * - LOSE_VACANCY: fulfilled only when the driver actually received at least
 *   one vacancy. If the driver got none, the punishment stays pending and
 *   rolls to the next week (it never expires on its own).
 * - NO_VACANCIES_WEEK: fulfilled after the driver is excluded for `multiplier`
 *   consecutive effective weeks.
 */
export function resolvePunishmentOutcomes(
  infractions: Pick<
    DriverInfraction,
    "id" | "driverProfileId" | "type" | "multiplier" | "weeksServed" | "effectiveStartDate" | "effectiveEndDate"
  >[],
  assignedCountByDriver: Map<string, number>
): PunishmentOutcome[] {
  const outcomes: PunishmentOutcome[] = [];
  for (const inf of infractions) {
    const rule = getInfractionRule(inf.type);
    const assigned = assignedCountByDriver.get(inf.driverProfileId) ?? 0;

    if (rule.punishment === "NO_VACANCIES_WEEK") {
      const weeksServed = inf.weeksServed + 1;
      if (isNoVacanciesWeekFulfilled(weeksServed, inf.multiplier)) {
        outcomes.push({ infractionId: inf.id, fulfilled: true });
      } else {
        outcomes.push({
          infractionId: inf.id,
          fulfilled: false,
          nextStart: addWeeks(inf.effectiveStartDate, 1),
          nextEnd: addWeeks(inf.effectiveEndDate, 1),
          nextWeeksServed: weeksServed,
        });
      }
    } else {
      if (isLoseVacancyFulfilled(assigned)) {
        outcomes.push({ infractionId: inf.id, fulfilled: true });
      } else {
        outcomes.push({
          infractionId: inf.id,
          fulfilled: false,
          nextStart: addWeeks(inf.effectiveStartDate, 1),
          nextEnd: addWeeks(inf.effectiveEndDate, 1),
        });
      }
    }
  }
  return outcomes;
}
