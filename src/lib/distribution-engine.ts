/**
 * Pure distribution engine for weekly vacancy allocation.
 *
 * This module has NO side effects: it never touches the database. It takes
 * the week, the vacancies, and the active drivers as input and returns a set
 * of candidate assignments plus diagnostics. The server action
 * `runDistribution` (in `dispatch/actions.ts`) is responsible for persisting
 * the returned assignments inside a transaction.
 *
 * Allocation rules (see docs/plans/driver-behavior-and-allocation-rules.md):
 *   1. Vehicle type is its own category: a Cargo Van vacancy only goes to a
 *      Cargo Van driver, Large Van only to Large Van, Passenger only to
 *      Passenger. No fallback.
 *   2. Minimum guarantee of 3 vacancies per week per active driver, when
 *      enough compatible vacancies exist. If not, distribute as many as
 *      possible and report the gap via `underQuotaDrivers`.
 *   3. Inactive drivers never enter the distribution.
 *   4. An expired CNH does NOT block allocation, but the driver is flagged in
 *      `expiredCnhAssignments` so the UI can show `*`.
 *   5. City preferences are NOT used in this phase.
 *   6. Extensible for future behavior penalties (step-4) via the
 *      `behaviorPenalty` hook on `DriverForAllocation` — not implemented yet.
 */

import type { DispatchWeek, Vacancy, VehicleType } from "@/generated/prisma";

/** Minimum guaranteed vacancies per active driver per week. */
export const MIN_WEEKLY_VACANCIES = 3;

/**
 * A driver eligible for allocation. `active` is always true for drivers that
 * reach the engine (the caller filters inactive ones), but it is kept here so
 * the pure function is self-contained and testable.
 */
export interface DriverForAllocation {
  /** DriverProfile.id — used to persist DispatchAssignment rows. */
  driverProfileId: string;
  /** User.id — used for display and tie-breaking fallback. */
  userId: string;
  name: string;
  vehicleType: VehicleType;
  active: boolean;
  /** CNH expiry date. null = unknown/not set (treated as NOT expired). */
  cnhExpiration: Date | null;
  /**
   * Future behavior-penalty hook (step-4). A positive value reduces the
   * driver's priority. Not used in this phase — always 0.
   */
  behaviorPenalty?: number;
  /**
   * Behavior punishment: number of vacancies to reduce from this driver's
   * weekly quota ("perde N vagas"). 0 or undefined = no reduction. The
   * punishment wins over the 3-vacancy minimum guarantee, so a punished
   * driver may end up below the minimum (intentional).
   */
  quotaReduction?: number;
  /**
   * Behavior punishment: when true the driver is excluded from the
   * distribution entirely for this week ("N semanas sem vagas").
   */
  excluded?: boolean;
  /**
   * Future punctuality/attendance score (step-4). Higher is better. When
   * absent, the engine falls back to controlled randomness.
   */
  reliabilityScore?: number;
}

export interface AllocationInput {
  week: DispatchWeek;
  vacancies: Vacancy[];
  drivers: DriverForAllocation[];
  /** Seed for the controlled-random tie-breaker. Defaults to a stable hash. */
  seed?: number;
}

export interface DispatchAssignment {
  vacancyId: string;
  driverProfileId: string;
  /** The driver's User.id, for the UI to resolve names. */
  userId: string;
  vehicleType: VehicleType;
  date: Date;
  shiftBlock: string;
}

export interface AllocationResult {
  assignments: DispatchAssignment[];
  /** Vacancies (by id) that had no compatible driver and were left unfilled. */
  unassignedVacancies: Vacancy[];
  /** Active drivers who did not reach the 3-vacancy minimum. */
  underQuotaDrivers: DriverForAllocation[];
  /** DriverProfile.ids of allocated drivers whose CNH is expired. */
  expiredCnhAssignments: string[];
}

/** Deterministic PRNG (mulberry32) so results are reproducible for a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable numeric hash of a string, used as the default seed. */
function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isCnhExpired(cnhExpiration: Date | null, now: Date): boolean {
  if (!cnhExpiration) return false;
  return cnhExpiration.getTime() < now.getTime();
}

/**
 * Expand each vacancy into `quantity` individual slots. Each slot keeps a
 * reference to its parent vacancy so we can persist assignments and report
 * which vacancies were left unfilled.
 */
function expandVacancies(vacancies: Vacancy[]): { vacancy: Vacancy; slotIndex: number }[] {
  const slots: { vacancy: Vacancy; slotIndex: number }[] = [];
  for (const v of vacancies) {
    for (let i = 0; i < v.quantity; i++) {
      slots.push({ vacancy: v, slotIndex: i });
    }
  }
  return slots;
}

/**
 * Allocate vacancies to drivers.
 *
 * Strategy:
 *   - Expand vacancies into individual slots.
 *   - Process slots grouped by vehicle type so each category competes only
 *     against compatible drivers (no cross-category fallback).
 *   - For each slot, pick the best compatible driver using the tie-breakers:
 *       1. Fewest vacancies already assigned this week (guarantee minimum first).
 *       2. Reliability/punctuality score, if present.
 *       3. Controlled random (seeded) to avoid bias.
 *   - A driver can fill at most one slot per vacancy (a vacancy is a single
 *     day+shift+vehicle slot; quantity expands into distinct slots, so a
 *     driver is not assigned twice to the same vacancy).
 */
export function allocateVacancies(input: AllocationInput): AllocationResult {
  const { week, vacancies, drivers } = input;
  const now = new Date();
  const seed = input.seed ?? hashString(week.id);

  const activeDrivers = drivers.filter((d) => d.active);
  const slots = expandVacancies(vacancies);

  // Track how many slots each driver has been assigned so far.
  const assignedCount = new Map<string, number>();
  for (const d of activeDrivers) {
    assignedCount.set(d.driverProfileId, 0);
  }

  // Track which vacancy ids a driver has already been assigned to, so a
  // driver never fills two slots of the same vacancy.
  const assignedVacancyIds = new Map<string, Set<string>>();
  for (const d of activeDrivers) {
    assignedVacancyIds.set(d.driverProfileId, new Set());
  }

  const assignments: DispatchAssignment[] = [];
  const unassignedVacancyIds = new Set<string>();
  const expiredCnhAssignments = new Set<string>();

  // Group slots by vehicle type so each category is allocated independently.
  const slotsByType = new Map<VehicleType, { vacancy: Vacancy; slotIndex: number }[]>();
  for (const slot of slots) {
    const list = slotsByType.get(slot.vacancy.vehicleType) ?? [];
    list.push(slot);
    slotsByType.set(slot.vacancy.vehicleType, list);
  }

  const rand = mulberry32(seed);

  for (const [vehicleType, typeSlots] of slotsByType) {
    const compatible = activeDrivers.filter(
      (d) => d.vehicleType === vehicleType && !d.excluded
    );

    // Fair-share base quota for this vehicle type group. Only punished drivers
    // are capped at (baseQuota - quotaReduction); the punishment wins over the
    // 3-vacancy minimum, so a punished driver may end up below the minimum.
    // Non-punished drivers keep no cap so all compatible slots can still be
    // filled (preserving the existing fill-all behavior).
    const baseQuota =
      compatible.length > 0 ? Math.floor(typeSlots.length / compatible.length) : 0;
    const maxQuota = new Map<string, number>();
    for (const d of compatible) {
      const reduction = d.quotaReduction ?? 0;
      maxQuota.set(
        d.driverProfileId,
        reduction > 0 ? Math.max(0, baseQuota - reduction) : Number.POSITIVE_INFINITY
      );
    }

    for (const slot of typeSlots) {
      const { vacancy } = slot;

      // Candidates: compatible drivers not already assigned to this vacancy
      // and not yet at their (possibly reduced) quota.
      const candidates = compatible.filter(
        (d) =>
          !assignedVacancyIds.get(d.driverProfileId)!.has(vacancy.id) &&
          assignedCount.get(d.driverProfileId)! < maxQuota.get(d.driverProfileId)!
      );

      if (candidates.length === 0) {
        unassignedVacancyIds.add(vacancy.id);
        continue;
      }

      // Sort by tie-breakers:
      //   1. Fewest assigned this week (ascending).
      //   2. Higher reliability score (descending), if present.
      //   3. Controlled random to break remaining ties.
      const sorted = [...candidates].sort((a, b) => {
        const aCount = assignedCount.get(a.driverProfileId)!;
        const bCount = assignedCount.get(b.driverProfileId)!;
        if (aCount !== bCount) return aCount - bCount;

        const aRel = a.reliabilityScore ?? 0;
        const bRel = b.reliabilityScore ?? 0;
        if (aRel !== bRel) return bRel - aRel;

        return rand() - rand();
      });

      const chosen = sorted[0];
      assignedCount.set(chosen.driverProfileId, assignedCount.get(chosen.driverProfileId)! + 1);
      assignedVacancyIds.get(chosen.driverProfileId)!.add(vacancy.id);

      assignments.push({
        vacancyId: vacancy.id,
        driverProfileId: chosen.driverProfileId,
        userId: chosen.userId,
        vehicleType: chosen.vehicleType,
        date: vacancy.date,
        shiftBlock: vacancy.shiftBlock,
      });

      if (isCnhExpired(chosen.cnhExpiration, now)) {
        expiredCnhAssignments.add(chosen.driverProfileId);
      }
    }
  }

  // Determine which vacancies were left completely unfilled.
  const filledVacancyIds = new Set(assignments.map((a) => a.vacancyId));
  const unassignedVacancies = vacancies.filter((v) => !filledVacancyIds.has(v.id));

  // Drivers below the minimum quota.
  const underQuotaDrivers = activeDrivers.filter(
    (d) => assignedCount.get(d.driverProfileId)! < MIN_WEEKLY_VACANCIES
  );

  return {
    assignments,
    unassignedVacancies,
    underQuotaDrivers,
    expiredCnhAssignments: [...expiredCnhAssignments],
  };
}
