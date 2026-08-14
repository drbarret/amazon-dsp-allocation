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
// Skipped when TEST_DATABASE_URL or DATABASE_URL is not configured.
// All created rows are cleaned up in afterAll.
// ---------------------------------------------------------------------------

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("dispatch vacancy integration", () => {
  const runId = Date.now();
  const email = `integration-supervisor-${runId}@example.com`;

  let transportCompanyId: string;
  let supervisorId: string;
  let weekId: string;
  let vacancyId: string;

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
    if (!databaseUrl) return;

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
    if (!databaseUrl) return;

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
    const result = await listVacancies(weekId);
    expect(result.success).toBe(true);
    expect(result.vacancies.length).toBe(1);
    expect(result.vacancies[0].quantity).toBe(3);
  });

  it("updates the vacancy", async () => {
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
    const deleteResult = await deleteVacancy(vacancyId);
    expect(deleteResult.success).toBe(true);

    const list = await listVacancies(weekId);
    expect(list.vacancies.length).toBe(0);
  });
});
