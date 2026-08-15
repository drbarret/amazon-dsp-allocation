import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import { runDistribution } from "../actions";

// ---------------------------------------------------------------------------
// End-to-end proof of the expired-CNH asterisk rule with real data.
// Creates a disposable company, supervisor, week, vacancies and two active
// Cargo Van drivers — one with an EXPIRED CNH, one with a valid CNH — runs
// the real distribution action, and verifies the expired-CNH driver is
// allocated normally AND flagged (cnhExpired: true). Then cleans up.
// ---------------------------------------------------------------------------

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe.skipIf(SKIP_INTEGRATION)("expired CNH asterisk proof", () => {
  const runId = Date.now();
  const email = `asterisk-supervisor-${runId}@example.com`;

  let transportCompanyId = "";
  let supervisorId = "";
  let weekId = "";
  let dbReady = false;

  const driverProfileIds: string[] = [];

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
    await requireDatabase();
    dbReady = true;

    const company = await prisma.transportCompany.create({
      data: { name: `Asterisk Company ${runId}` },
    });
    transportCompanyId = company.id;

    const supervisor = await prisma.user.create({
      data: {
        email,
        name: "Asterisk Supervisor",
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    });
    supervisorId = supervisor.id;

    const week = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-AST-${runId}`,
        year: 2026,
        weekNumber: 35,
        startDate: new Date("2026-08-30"),
        endDate: new Date("2026-09-05"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    weekId = week.id;

    // Driver 0: EXPIRED CNH (2020-01-01, well in the past).
    const expiredUser = await prisma.user.create({
      data: {
        email: `ast-expired-${runId}@example.com`,
        name: "Asterisk Expired",
        role: "DRIVER",
        active: true,
        transportCompanyId,
        driverProfile: {
          create: {
            vehicleType: "CARGO_VAN",
            onboardingCompleted: true,
            cnhExpiration: new Date("2020-01-01"),
          },
        },
      },
    });
    const expiredProfile = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId: expiredUser.id },
      select: { id: true },
    });
    driverProfileIds.push(expiredProfile.id);

    // Driver 1: VALID CNH (2035-01-01, far in the future).
    const validUser = await prisma.user.create({
      data: {
        email: `ast-valid-${runId}@example.com`,
        name: "Asterisk Valid",
        role: "DRIVER",
        active: true,
        transportCompanyId,
        driverProfile: {
          create: {
            vehicleType: "CARGO_VAN",
            onboardingCompleted: true,
            cnhExpiration: new Date("2035-01-01"),
          },
        },
      },
    });
    const validProfile = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId: validUser.id },
      select: { id: true },
    });
    driverProfileIds.push(validProfile.id);

    mockAuth.mockResolvedValue(session() as never);
  });

  afterAll(async () => {
    if (!dbReady) return;

    await prisma.dispatchAssignment.deleteMany({
      where: { driverProfileId: { in: driverProfileIds } },
    });
    await prisma.vacancy.deleteMany({ where: { dispatchWeekId: weekId } });
    await prisma.dispatchWeek.deleteMany({ where: { id: weekId } });
    await prisma.user.deleteMany({
      where: { transportCompanyId, role: "DRIVER" },
    });
    await prisma.user.deleteMany({ where: { id: supervisorId } });
    await prisma.transportCompany.deleteMany({ where: { id: transportCompanyId } });
  });

  it("allocates an expired-CNH driver normally and flags it with the asterisk", async () => {
    // 4 Cargo Van vacancies (2 each for 2 drivers).
    const vacancyIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const v = await prisma.vacancy.create({
        data: {
          dispatchWeekId: weekId,
          date: new Date(2026, 7, 30 + i),
          vehicleType: "CARGO_VAN",
          shiftBlock: `Bloco ${i}`,
          quantity: 1,
          createdById: supervisorId,
        },
      });
      vacancyIds.push(v.id);
    }

    const result = await runDistribution(weekId);
    expect(result.success).toBe(true);
    expect(result.result?.assignedCount).toBe(4);

    // The expired-CNH driver must be allocated normally (not blocked).
    const expiredAssignments = result.result!.assignments.filter(
      (a) => a.driverProfileId === driverProfileIds[0]
    );
    expect(expiredAssignments.length).toBeGreaterThan(0);
    // ...and every one of its assignments must carry the expired flag.
    for (const a of expiredAssignments) {
      expect(a.cnhExpired).toBe(true);
    }

    // The valid-CNH driver must be allocated and NOT flagged.
    const validAssignments = result.result!.assignments.filter(
      (a) => a.driverProfileId === driverProfileIds[1]
    );
    expect(validAssignments.length).toBeGreaterThan(0);
    for (const a of validAssignments) {
      expect(a.cnhExpired).toBe(false);
    }

    // The action-level expired count must be > 0.
    expect(result.result!.expiredCnhCount).toBeGreaterThan(0);

    // Persisted assignments exist for the expired driver.
    const persisted = await prisma.dispatchAssignment.findMany({
      where: { driverProfileId: driverProfileIds[0] },
    });
    expect(persisted.length).toBeGreaterThan(0);

    // Cleanup vacancies.
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
  });
});
