import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createVacancy,
  updateVacancy,
  deleteVacancy,
  listVacancies,
} from "../actions";

// ---------------------------------------------------------------------------
// Integration test against a real Postgres database.
// The suite is skipped automatically when no database is reachable.
// ---------------------------------------------------------------------------

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

let dbReachable = false;

describe("dispatch vacancy integration", () => {
  const runId = Date.now();
  const email = `integration-supervisor-${runId}@example.com`;

  let transportCompanyId = "";
  let supervisorId = "";
  let weekId = "";
  let vacancyId = "";
  let skipped = false;

  function session() {
    return {
      user: {
        id: supervisorId,
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    };
  }

  beforeAll(async () => {
    dbReachable = await isDatabaseReachable();
    if (!dbReachable) {
      skipped = true;
      return;
    }

    const company = await prisma.transportCompany.create({
      data: { name: `Integration Company ${runId}` },
    });
    transportCompanyId = company.id;

    const supervisor = await prisma.user.create({
      data: {
        email,
        name: "Integration Supervisor",
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    });
    supervisorId = supervisor.id;

    const week = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-${runId}`,
        year: 2026,
        weekNumber: 33,
        startDate: new Date("2026-08-16"),
        endDate: new Date("2026-08-22"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    weekId = week.id;

    mockAuth.mockResolvedValue(session() as never);
  });

  afterAll(async () => {
    if (!dbReachable) return;

    await prisma.vacancy.deleteMany({ where: { dispatchWeekId: weekId } });
    await prisma.dispatchWeek.deleteMany({ where: { id: weekId } });
    await prisma.user.deleteMany({ where: { id: supervisorId } });
    await prisma.transportCompany.deleteMany({ where: { id: transportCompanyId } });
  });

  beforeEach(() => {
    if (supervisorId) {
      mockAuth.mockResolvedValue(session() as never);
    }
  });

  it("creates a vacancy", async () => {
    if (skipped) return;

    const result = await createVacancy({
      dispatchWeekId: weekId,
      date: "2026-08-17",
      vehicleType: "CARGO_VAN",
      shiftBlock: "Manhã",
      quantity: 3,
    });

    expect(result.success).toBe(true);
    expect(result.vacancy).toBeDefined();
    vacancyId = result.vacancy!.id;
  });

  it("lists vacancies for the week", async () => {
    if (skipped) return;

    const result = await listVacancies(weekId);
    expect(result.success).toBe(true);
    expect(result.vacancies.length).toBe(1);
    expect(result.vacancies[0].quantity).toBe(3);
  });

  it("updates the vacancy", async () => {
    if (skipped) return;

    const result = await updateVacancy(vacancyId, {
      dispatchWeekId: weekId,
      date: "2026-08-17",
      vehicleType: "LARGE_VAN",
      shiftBlock: "Tarde",
      quantity: 5,
    });

    expect(result.success).toBe(true);

    const list = await listVacancies(weekId);
    expect(list.vacancies[0].vehicleType).toBe("LARGE_VAN");
    expect(list.vacancies[0].quantity).toBe(5);
  });

  it("deletes the vacancy and restores counts", async () => {
    if (skipped) return;

    const deleteResult = await deleteVacancy(vacancyId);
    expect(deleteResult.success).toBe(true);

    const list = await listVacancies(weekId);
    expect(list.vacancies.length).toBe(0);
  });
});
