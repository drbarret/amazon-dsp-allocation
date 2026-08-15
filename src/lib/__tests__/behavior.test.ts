import { describe, it, expect } from "vitest";
import {
  INFRACTION_TYPE_LIST,
  getInfractionRule,
  computeEffectiveWeek,
  computeMultiplier,
  isRecidivismMark,
  selectInfractionsToEscalate,
  isLoseVacancyFulfilled,
  isNoVacanciesWeekFulfilled,
  describePunishment,
  RECIDIVISM_WINDOW_WEEKS,
} from "@/lib/behavior";
import {
  applyPunishmentsToDrivers,
  resolvePunishmentOutcomes,
} from "@/lib/behavior-distribution";
import { allocateVacancies } from "@/lib/distribution-engine";
import type { InfractionType } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// The 5 infraction types and their punishments (spec §3.1)
// ---------------------------------------------------------------------------
describe("the 5 infraction types and their punishments", () => {
  it("defines exactly the 5 user-confirmed types", () => {
    expect(INFRACTION_TYPE_LIST).toHaveLength(5);
    const types = INFRACTION_TYPE_LIST.map((r) => r.type).sort();
    expect(types).toEqual(
      [
        "ABANDONO_ROTA",
        "DESCUMPRIR_REGRAS_AMAZON",
        "FALTAS_RECORRENTES",
        "NAO_REVERTER_INSUCESSOS",
        "RECLAMACAO_ASPERA",
      ].sort()
    );
  });

  it("NAO_REVERTER_INSUCESSOS (objetivo) → perde 1 vaga, no approval", () => {
    const r = getInfractionRule("NAO_REVERTER_INSUCESSOS");
    expect(r.punishment).toBe("LOSE_VACANCY");
    expect(r.requiresApproval).toBe(false);
    expect(describePunishment("NAO_REVERTER_INSUCESSOS", 1)).toBe("perde 1 vaga");
  });

  it("RECLAMACAO_ASPERA (subjetivo) → perde 1 vaga, REQUIRES approval", () => {
    const r = getInfractionRule("RECLAMACAO_ASPERA");
    expect(r.punishment).toBe("LOSE_VACANCY");
    expect(r.requiresApproval).toBe(true);
    expect(describePunishment("RECLAMACAO_ASPERA", 1)).toBe("perde 1 vaga");
  });

  it("FALTAS_RECORRENTES (objetivo) → perde 1 vaga, no approval", () => {
    const r = getInfractionRule("FALTAS_RECORRENTES");
    expect(r.punishment).toBe("LOSE_VACANCY");
    expect(r.requiresApproval).toBe(false);
    expect(describePunishment("FALTAS_RECORRENTES", 1)).toBe("perde 1 vaga");
  });

  it("ABANDONO_ROTA (grave) → 1 semana sem vagas, no approval", () => {
    const r = getInfractionRule("ABANDONO_ROTA");
    expect(r.punishment).toBe("NO_VACANCIES_WEEK");
    expect(r.requiresApproval).toBe(false);
    expect(describePunishment("ABANDONO_ROTA", 1)).toBe("1 semana sem vagas");
  });

  it("DESCUMPRIR_REGRAS_AMAZON (misto) → perde 1 vaga, no approval", () => {
    const r = getInfractionRule("DESCUMPRIR_REGRAS_AMAZON");
    expect(r.punishment).toBe("LOSE_VACANCY");
    expect(r.requiresApproval).toBe(false);
    expect(describePunishment("DESCUMPRIR_REGRAS_AMAZON", 1)).toBe("perde 1 vaga");
  });

  it("only RECLAMACAO_ASPERA requires approval among the 5", () => {
    const requiring = INFRACTION_TYPE_LIST.filter((r) => r.requiresApproval);
    expect(requiring.map((r) => r.type)).toEqual(["RECLAMACAO_ASPERA"]);
  });
});

// ---------------------------------------------------------------------------
// Punishment applies the week AFTER the mark (spec §3.3.1)
// ---------------------------------------------------------------------------
describe("punishment applies the week after the mark", () => {
  it("computes the effective week as the week after the marked week", () => {
    // Marked week: Mon 2026-08-17 .. Sun 2026-08-23
    const markedStart = new Date("2026-08-17");
    const markedEnd = new Date("2026-08-23");
    const eff = computeEffectiveWeek(markedStart, markedEnd);
    // Effective week starts the day after the marked week ends.
    expect(eff.start.toISOString().split("T")[0]).toBe("2026-08-24");
    expect(eff.end.toISOString().split("T")[0]).toBe("2026-08-30");
  });
});

// ---------------------------------------------------------------------------
// Punishment only fulfilled when the driver actually loses a vacancy (spec §3.3.3)
// ---------------------------------------------------------------------------
describe("LOSE_VACANCY is only fulfilled when the driver actually loses a vacancy", () => {
  const loseInfraction = (overrides: Record<string, unknown> = {}) => ({
    id: "inf-1",
    driverProfileId: "driver-1",
    type: "NAO_REVERTER_INSUCESSOS" as InfractionType,
    multiplier: 1,
    weeksServed: 0,
    effectiveStartDate: new Date("2026-08-24"),
    effectiveEndDate: new Date("2026-08-30"),
    ...overrides,
  });

  it("is fulfilled when the driver receives at least one vacancy", () => {
    const outcomes = resolvePunishmentOutcomes(
      [loseInfraction()],
      new Map([["driver-1", 1]])
    );
    expect(outcomes[0].fulfilled).toBe(true);
  });

  it("stays PENDING (rolls forward) when the driver receives NO vacancy", () => {
    const outcomes = resolvePunishmentOutcomes(
      [loseInfraction()],
      new Map([["driver-1", 0]])
    );
    expect(outcomes[0].fulfilled).toBe(false);
    // Rolls to the next week.
    expect(outcomes[0].nextStart!.toISOString().split("T")[0]).toBe("2026-08-31");
    expect(outcomes[0].nextEnd!.toISOString().split("T")[0]).toBe("2026-09-06");
  });

  it("is fulfilled when the driver receives a vacancy even if below the 3 minimum", () => {
    // A punished driver may end up below the minimum; receiving 1 vacancy still
    // fulfills the punishment.
    const outcomes = resolvePunishmentOutcomes(
      [loseInfraction()],
      new Map([["driver-1", 1]])
    );
    expect(outcomes[0].fulfilled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NO_VACANCIES_WEEK is fulfilled after serving `multiplier` weeks (spec §3.3)
// ---------------------------------------------------------------------------
describe("NO_VACANCIES_WEEK fulfillment", () => {
  const abandonInfraction = (overrides: Record<string, unknown> = {}) => ({
    id: "inf-2",
    driverProfileId: "driver-2",
    type: "ABANDONO_ROTA" as InfractionType,
    multiplier: 1,
    weeksServed: 0,
    effectiveStartDate: new Date("2026-08-24"),
    effectiveEndDate: new Date("2026-08-30"),
    ...overrides,
  });

  it("is fulfilled after 1 excluded week (multiplier 1)", () => {
    const outcomes = resolvePunishmentOutcomes(
      [abandonInfraction()],
      new Map([["driver-2", 0]])
    );
    expect(outcomes[0].fulfilled).toBe(true);
  });

  it("is fulfilled after 2 excluded weeks when recidivism doubled (multiplier 2)", () => {
    // First week served → not yet fulfilled.
    const first = resolvePunishmentOutcomes(
      [abandonInfraction({ multiplier: 2 })],
      new Map([["driver-2", 0]])
    );
    expect(first[0].fulfilled).toBe(false);
    expect(first[0].nextWeeksServed).toBe(1);

    // Second week served → fulfilled.
    const second = resolvePunishmentOutcomes(
      [abandonInfraction({ multiplier: 2, weeksServed: 1 })],
      new Map([["driver-2", 0]])
    );
    expect(second[0].fulfilled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Punishment effect on the distribution engine (spec §3.3 / §4)
// ---------------------------------------------------------------------------
describe("punishment effect on distribution", () => {
  it("LOSE_VACANCY reduces the driver's quota by the multiplier", () => {
    const effects = applyPunishmentsToDrivers([
      { driverProfileId: "d1", type: "NAO_REVERTER_INSUCESSOS", multiplier: 1 },
    ]);
    expect(effects.get("d1")).toEqual({ quotaReduction: 1, excluded: false });
  });

  it("recidivism doubles the quota reduction", () => {
    const effects = applyPunishmentsToDrivers([
      { driverProfileId: "d1", type: "NAO_REVERTER_INSUCESSOS", multiplier: 2 },
    ]);
    expect(effects.get("d1")).toEqual({ quotaReduction: 2, excluded: false });
  });

  it("ABANDONO_ROTA excludes the driver entirely", () => {
    const effects = applyPunishmentsToDrivers([
      { driverProfileId: "d1", type: "ABANDONO_ROTA", multiplier: 1 },
    ]);
    expect(effects.get("d1")).toEqual({ quotaReduction: 0, excluded: true });
  });

  it("sums multiple infractions for the same driver", () => {
    const effects = applyPunishmentsToDrivers([
      { driverProfileId: "d1", type: "NAO_REVERTER_INSUCESSOS", multiplier: 1 },
      { driverProfileId: "d1", type: "FALTAS_RECORRENTES", multiplier: 1 },
    ]);
    expect(effects.get("d1")).toEqual({ quotaReduction: 2, excluded: false });
  });
});

// ---------------------------------------------------------------------------
// Recidivism doubles the punishment (spec §3.4)
// ---------------------------------------------------------------------------
describe("recidivism doubles the punishment", () => {
  it("a new mark while a punishment is ACTIVE is recidivism", () => {
    expect(isRecidivismMark(true, null, new Date())).toBe(true);
  });

  it("a new mark within the window after fulfillment is recidivism", () => {
    const now = new Date("2026-08-15");
    const lastFulfilled = new Date(now.getTime() - 1 * 7 * 24 * 3600 * 1000); // 1 week ago
    expect(isRecidivismMark(false, lastFulfilled, now)).toBe(true);
  });

  it("a new mark outside the window after fulfillment is NOT recidivism", () => {
    const now = new Date("2026-08-15");
    const lastFulfilled = new Date(
      now.getTime() - (RECIDIVISM_WINDOW_WEEKS + 1) * 7 * 24 * 3600 * 1000
    );
    expect(isRecidivismMark(false, lastFulfilled, now)).toBe(false);
  });

  it("a first mark (no history) is not recidivism", () => {
    expect(isRecidivismMark(false, null, new Date())).toBe(false);
  });

  it("computeMultiplier returns 2 for recidivism and 1 otherwise", () => {
    expect(computeMultiplier(true)).toBe(2);
    expect(computeMultiplier(false)).toBe(1);
  });

  it("describes the doubled punishment", () => {
    expect(describePunishment("NAO_REVERTER_INSUCESSOS", 2)).toBe("perde 2 vagas");
    expect(describePunishment("ABANDONO_ROTA", 2)).toBe("2 semanas sem vagas");
  });
});

// ---------------------------------------------------------------------------
// Recidivism warning to supervisor and escalation to managers (spec §3.4)
// ---------------------------------------------------------------------------
describe("recidivism warning and escalation by distribution cycle", () => {
  const candidate = (overrides: Record<string, unknown> = {}) => ({
    id: "inf-esc",
    driverProfileId: "driver-1",
    supervisorNotifiedAt: new Date("2026-08-15"),
    escalatedAt: null,
    status: "ACTIVE",
    ...overrides,
  });

  it("escalates a pending warning when a new cycle runs", () => {
    const ids = selectInfractionsToEscalate(
      [candidate()],
      new Set(["driver-1"])
    );
    expect(ids).toEqual(["inf-esc"]);
  });

  it("does NOT escalate when the supervisor was never notified", () => {
    const ids = selectInfractionsToEscalate(
      [candidate({ supervisorNotifiedAt: null })],
      new Set(["driver-1"])
    );
    expect(ids).toEqual([]);
  });

  it("does NOT escalate an infraction already escalated (idempotency)", () => {
    const ids = selectInfractionsToEscalate(
      [candidate({ escalatedAt: new Date("2026-08-16") })],
      new Set(["driver-1"])
    );
    expect(ids).toEqual([]);
  });

  it("does NOT escalate a CANCELLED infraction", () => {
    const ids = selectInfractionsToEscalate(
      [candidate({ status: "CANCELLED" })],
      new Set(["driver-1"])
    );
    expect(ids).toEqual([]);
  });

  it("does NOT escalate when the supervisor decided (driver deactivated)", () => {
    // The driver is no longer active → the supervisor decided (deactivated).
    const ids = selectInfractionsToEscalate(
      [candidate()],
      new Set(["other-driver"])
    );
    expect(ids).toEqual([]);
  });

  it("escalates only the pending ones among a mixed set", () => {
    const ids = selectInfractionsToEscalate(
      [
        candidate({ id: "a" }),
        candidate({ id: "b", escalatedAt: new Date() }),
        candidate({ id: "c", supervisorNotifiedAt: null }),
        candidate({ id: "d", status: "CANCELLED" }),
        candidate({ id: "e", driverProfileId: "inactive-driver" }),
      ],
      new Set(["driver-1"])
    );
    expect(ids).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// Fulfillment helpers
// ---------------------------------------------------------------------------
describe("fulfillment helpers", () => {
  it("isLoseVacancyFulfilled requires at least one assigned vacancy", () => {
    expect(isLoseVacancyFulfilled(0)).toBe(false);
    expect(isLoseVacancyFulfilled(1)).toBe(true);
    expect(isLoseVacancyFulfilled(3)).toBe(true);
  });

  it("isNoVacanciesWeekFulfilled requires weeksServed >= multiplier", () => {
    expect(isNoVacanciesWeekFulfilled(0, 1)).toBe(false);
    expect(isNoVacanciesWeekFulfilled(1, 1)).toBe(true);
    expect(isNoVacanciesWeekFulfilled(1, 2)).toBe(false);
    expect(isNoVacanciesWeekFulfilled(2, 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The punishment wins over the 3-vacancy minimum (spec §4)
// ---------------------------------------------------------------------------
describe("punishment wins over the 3-vacancy minimum", () => {
  it("a LOSE_VACANCY driver can end up below the minimum", () => {
    // 2 Cargo Van drivers, 6 vacancies → base quota 3 each. Driver A is
    // punished (quotaReduction 1) → capped at 2, so A gets 2 (< 3 minimum).
    const result = allocateVacancies({
      week: {
        id: "week-1",
        transportCompanyId: "tc-1",
        weekKey: "WK-1",
        year: 2026,
        weekNumber: 1,
        startDate: new Date("2026-08-17"),
        endDate: new Date("2026-08-23"),
        status: "PLANNING",
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      vacancies: Array.from({ length: 6 }, (_, i) => ({
        id: `v${i}`,
        dispatchWeekId: "week-1",
        date: new Date("2026-08-17"),
        vehicleType: "CARGO_VAN" as const,
        shiftBlock: "Manhã",
        quantity: 1,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      drivers: [
        {
          driverProfileId: "a",
          userId: "ua",
          name: "A",
          vehicleType: "CARGO_VAN" as const,
          active: true,
          cnhExpiration: null,
          quotaReduction: 1,
        },
        {
          driverProfileId: "b",
          userId: "ub",
          name: "B",
          vehicleType: "CARGO_VAN" as const,
          active: true,
          cnhExpiration: null,
        },
      ],
      seed: 1,
    });

    const countA = result.assignments.filter((a) => a.driverProfileId === "a").length;
    const countB = result.assignments.filter((a) => a.driverProfileId === "b").length;
    // A is capped at 2 (below the 3 minimum); B absorbs the rest.
    expect(countA).toBe(2);
    expect(countB).toBe(4);
    // A is reported as under-quota (punishment wins over the minimum).
    expect(result.underQuotaDrivers.map((d) => d.driverProfileId)).toContain("a");
  });

  it("an excluded driver receives no vacancies", () => {
    const result = allocateVacancies({
      week: {
        id: "week-1",
        transportCompanyId: "tc-1",
        weekKey: "WK-1",
        year: 2026,
        weekNumber: 1,
        startDate: new Date("2026-08-17"),
        endDate: new Date("2026-08-23"),
        status: "PLANNING",
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      vacancies: Array.from({ length: 4 }, (_, i) => ({
        id: `v${i}`,
        dispatchWeekId: "week-1",
        date: new Date("2026-08-17"),
        vehicleType: "CARGO_VAN" as const,
        shiftBlock: "Manhã",
        quantity: 1,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      drivers: [
        {
          driverProfileId: "a",
          userId: "ua",
          name: "A",
          vehicleType: "CARGO_VAN" as const,
          active: true,
          cnhExpiration: null,
          excluded: true,
        },
        {
          driverProfileId: "b",
          userId: "ub",
          name: "B",
          vehicleType: "CARGO_VAN" as const,
          active: true,
          cnhExpiration: null,
        },
      ],
      seed: 1,
    });

    expect(result.assignments.every((a) => a.driverProfileId === "b")).toBe(true);
    expect(result.assignments).toHaveLength(4);
  });
});
