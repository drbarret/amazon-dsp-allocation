import { describe, it, expect } from "vitest";
import {
  allocateVacancies,
  MIN_WEEKLY_VACANCIES,
  type AllocationInput,
  type DriverForAllocation,
} from "@/lib/distribution-engine";
import type { DispatchWeek, Vacancy, VehicleType } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWeek(overrides: Partial<DispatchWeek> = {}): DispatchWeek {
  return {
    id: "week-1",
    transportCompanyId: "tc-1",
    weekKey: "WK-33",
    year: 2026,
    weekNumber: 33,
    startDate: new Date("2026-08-16"),
    endDate: new Date("2026-08-22"),
    status: "PLANNING",
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as DispatchWeek;
}

function makeVacancy(
  id: string,
  vehicleType: VehicleType,
  quantity = 1,
  overrides: Partial<Vacancy> = {}
): Vacancy {
  return {
    id,
    dispatchWeekId: "week-1",
    date: new Date("2026-08-17"),
    vehicleType,
    shiftBlock: "Manhã",
    quantity,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Vacancy;
}

function makeDriver(
  driverProfileId: string,
  vehicleType: VehicleType,
  overrides: Partial<DriverForAllocation> = {}
): DriverForAllocation {
  return {
    driverProfileId,
    userId: `user-${driverProfileId}`,
    name: `Driver ${driverProfileId}`,
    vehicleType,
    active: true,
    cnhExpiration: null,
    ...overrides,
  };
}

function run(input: Omit<AllocationInput, "week"> & { week?: DispatchWeek }) {
  return allocateVacancies({ week: makeWeek(), ...input });
}

// ---------------------------------------------------------------------------
// Vehicle type as its own category
// ---------------------------------------------------------------------------

describe("vehicle type as its own category", () => {
  it("assigns a Cargo Van vacancy only to a Cargo Van driver", () => {
    const result = run({
      vacancies: [makeVacancy("v1", "CARGO_VAN")],
      drivers: [
        makeDriver("cv", "CARGO_VAN"),
        makeDriver("lv", "LARGE_VAN"),
        makeDriver("ps", "PASSEIO"),
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].driverProfileId).toBe("cv");
    expect(result.unassignedVacancies).toHaveLength(0);
  });

  it("does not assign a Large Van vacancy to a Passenger driver", () => {
    const result = run({
      vacancies: [makeVacancy("v1", "LARGE_VAN")],
      drivers: [
        makeDriver("ps", "PASSEIO"),
        makeDriver("cv", "CARGO_VAN"),
      ],
    });

    // No compatible driver → vacancy left unassigned.
    expect(result.assignments).toHaveLength(0);
    expect(result.unassignedVacancies.map((v) => v.id)).toEqual(["v1"]);
  });

  it("does not fall back across categories when only incompatible drivers exist", () => {
    const result = run({
      vacancies: [makeVacancy("v1", "PASSEIO")],
      drivers: [makeDriver("cv", "CARGO_VAN")],
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unassignedVacancies).toHaveLength(1);
  });

  it("allocates each vehicle category independently", () => {
    const result = run({
      vacancies: [
        makeVacancy("v1", "CARGO_VAN"),
        makeVacancy("v2", "LARGE_VAN"),
        makeVacancy("v3", "PASSEIO"),
      ],
      drivers: [
        makeDriver("cv", "CARGO_VAN"),
        makeDriver("lv", "LARGE_VAN"),
        makeDriver("ps", "PASSEIO"),
      ],
    });

    expect(result.assignments).toHaveLength(3);
    const byVacancy = new Map(result.assignments.map((a) => [a.vacancyId, a.driverProfileId]));
    expect(byVacancy.get("v1")).toBe("cv");
    expect(byVacancy.get("v2")).toBe("lv");
    expect(byVacancy.get("v3")).toBe("ps");
  });
});

// ---------------------------------------------------------------------------
// Minimum guarantee of 3 vacancies
// ---------------------------------------------------------------------------

describe("minimum guarantee of 3 vacancies", () => {
  it("gives each compatible driver at least 3 vacancies when enough exist", () => {
    // 2 Cargo Van drivers, 8 Cargo Van vacancies → each gets 4.
    const result = run({
      vacancies: [
        makeVacancy("v1", "CARGO_VAN"),
        makeVacancy("v2", "CARGO_VAN"),
        makeVacancy("v3", "CARGO_VAN"),
        makeVacancy("v4", "CARGO_VAN"),
        makeVacancy("v5", "CARGO_VAN"),
        makeVacancy("v6", "CARGO_VAN"),
        makeVacancy("v7", "CARGO_VAN"),
        makeVacancy("v8", "CARGO_VAN"),
      ],
      drivers: [makeDriver("a", "CARGO_VAN"), makeDriver("b", "CARGO_VAN")],
    });

    expect(result.assignments).toHaveLength(8);
    const count = (id: string) =>
      result.assignments.filter((a) => a.driverProfileId === id).length;
    expect(count("a")).toBe(4);
    expect(count("b")).toBe(4);
    expect(result.underQuotaDrivers).toHaveLength(0);
  });

  it("reports under-quota drivers when there are not enough vacancies", () => {
    // 2 Cargo Van drivers, 4 Cargo Van vacancies → each gets 2 (< 3).
    const result = run({
      vacancies: [
        makeVacancy("v1", "CARGO_VAN"),
        makeVacancy("v2", "CARGO_VAN"),
        makeVacancy("v3", "CARGO_VAN"),
        makeVacancy("v4", "CARGO_VAN"),
      ],
      drivers: [makeDriver("a", "CARGO_VAN"), makeDriver("b", "CARGO_VAN")],
    });

    expect(result.assignments).toHaveLength(4);
    expect(result.underQuotaDrivers.map((d) => d.driverProfileId).sort()).toEqual(["a", "b"]);
  });

  it("distributes fairly when vacancies are scarce (balanced counts)", () => {
    // 3 Cargo Van drivers, 5 vacancies → counts 2,2,1 (balanced).
    const result = run({
      vacancies: [
        makeVacancy("v1", "CARGO_VAN"),
        makeVacancy("v2", "CARGO_VAN"),
        makeVacancy("v3", "CARGO_VAN"),
        makeVacancy("v4", "CARGO_VAN"),
        makeVacancy("v5", "CARGO_VAN"),
      ],
      drivers: [makeDriver("a", "CARGO_VAN"), makeDriver("b", "CARGO_VAN"), makeDriver("c", "CARGO_VAN")],
    });

    expect(result.assignments).toHaveLength(5);
    const counts = ["a", "b", "c"].map(
      (id) => result.assignments.filter((a) => a.driverProfileId === id).length
    );
    // Balanced: max - min <= 1.
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("does not assign a driver twice to the same vacancy", () => {
    // One vacancy with quantity 3 → a single driver must not fill all 3 slots.
    const result = run({
      vacancies: [makeVacancy("v1", "CARGO_VAN", 3)],
      drivers: [makeDriver("a", "CARGO_VAN"), makeDriver("b", "CARGO_VAN")],
    });

    expect(result.assignments).toHaveLength(2);
    const aCount = result.assignments.filter((a) => a.driverProfileId === "a").length;
    const bCount = result.assignments.filter((a) => a.driverProfileId === "b").length;
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Inactive drivers
// ---------------------------------------------------------------------------

describe("inactive drivers", () => {
  it("ignores inactive drivers entirely", () => {
    const result = run({
      vacancies: [makeVacancy("v1", "CARGO_VAN")],
      drivers: [
        makeDriver("active", "CARGO_VAN"),
        makeDriver("inactive", "CARGO_VAN", { active: false }),
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].driverProfileId).toBe("active");
  });

  it("does not count inactive drivers toward the quota", () => {
    // 2 vacancies, 1 active + 1 inactive driver. The inactive driver must not
    // absorb any vacancy, so the active driver gets 2 (< 3) and is under quota.
    const result = run({
      vacancies: [
        makeVacancy("v1", "CARGO_VAN"),
        makeVacancy("v2", "CARGO_VAN"),
      ],
      drivers: [
        makeDriver("a", "CARGO_VAN"),
        makeDriver("inactive", "CARGO_VAN", { active: false }),
      ],
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.every((a) => a.driverProfileId === "a")).toBe(true);
    expect(result.underQuotaDrivers.map((d) => d.driverProfileId)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// Expired CNH
// ---------------------------------------------------------------------------

describe("expired CNH", () => {
  it("allocates a driver with expired CNH but flags them", () => {
    const result = run({
      vacancies: [makeVacancy("v1", "CARGO_VAN")],
      drivers: [
        makeDriver("expired", "CARGO_VAN", {
          cnhExpiration: new Date("2020-01-01"),
        }),
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].driverProfileId).toBe("expired");
    expect(result.expiredCnhAssignments).toContain("expired");
  });

  it("does not flag a driver with a valid (future) CNH", () => {
    const result = run({
      vacancies: [makeVacancy("v1", "CARGO_VAN")],
      drivers: [
        makeDriver("valid", "CARGO_VAN", {
          cnhExpiration: new Date("2099-01-01"),
        }),
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.expiredCnhAssignments).not.toContain("valid");
  });

  it("does not flag a driver with no CNH date set", () => {
    const result = run({
      vacancies: [makeVacancy("v1", "CARGO_VAN")],
      drivers: [makeDriver("none", "CARGO_VAN", { cnhExpiration: null })],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.expiredCnhAssignments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism / seed
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("produces identical results for the same seed", () => {
    const input = {
      vacancies: [
        makeVacancy("v1", "CARGO_VAN"),
        makeVacancy("v2", "CARGO_VAN"),
        makeVacancy("v3", "CARGO_VAN"),
      ],
      drivers: [
        makeDriver("a", "CARGO_VAN"),
        makeDriver("b", "CARGO_VAN"),
        makeDriver("c", "CARGO_VAN"),
      ],
      seed: 42,
    };

    const r1 = run(input);
    const r2 = run(input);
    expect(r1.assignments.map((a) => a.driverProfileId)).toEqual(
      r2.assignments.map((a) => a.driverProfileId)
    );
  });

  it("exposes the minimum weekly quota constant", () => {
    expect(MIN_WEEKLY_VACANCIES).toBe(3);
  });
});
