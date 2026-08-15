import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import { runDistribution } from "../actions";

// ---------------------------------------------------------------------------
// Integration test for the distribution algorithm against a real Postgres DB.
// Uses disposable data: creates a company, supervisor, week, vacancies and
// drivers, runs the distribution, verifies persistence, then deletes
// everything and restores counts.
// The database is MANDATORY: if it is unreachable the suite FAILS HIGH.
// The only legitimate way to skip is SKIP_INTEGRATION_TESTS=1 (set by CI,
// which has no database) — that marks the suite as skipped, never passed.
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

describe.skipIf(SKIP_INTEGRATION)("distribution integration", () => {
  const runId = Date.now();
  const email = `distribution-supervisor-${runId}@example.com`;

  let transportCompanyId = "";
  let supervisorId = "";
  let weekId = "";
  let dbReady = false;

  // Driver profile ids created for this test.
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
      data: { name: `Distribution Company ${runId}` },
    });
    transportCompanyId = company.id;

    const supervisor = await prisma.user.create({
      data: {
        email,
        name: "Distribution Supervisor",
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    });
    supervisorId = supervisor.id;

    const week = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-DIST-${runId}`,
        year: 2026,
        weekNumber: 34,
        startDate: new Date("2026-08-23"),
        endDate: new Date("2026-08-29"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    weekId = week.id;

    // Create 2 Cargo Van drivers.
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({
        data: {
          email: `dist-driver-${i}-${runId}@example.com`,
          name: `Dist Driver ${i}`,
          role: "DRIVER",
          active: true,
          transportCompanyId,
          driverProfile: {
            create: {
              vehicleType: "CARGO_VAN",
              onboardingCompleted: true,
            },
          },
        },
      });
      const profile = await prisma.driverProfile.findUniqueOrThrow({
        where: { userId: user.id },
        select: { id: true },
      });
      driverProfileIds.push(profile.id);
    }

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

  beforeEach(() => {
    if (supervisorId) {
      mockAuth.mockResolvedValue(session() as never);
    }
  });

  it("runs distribution, persists assignments, and is idempotent", async () => {
    // Create 6 Cargo Van vacancies (enough for 3 each for 2 drivers).
    const vacancyIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const v = await prisma.vacancy.create({
        data: {
          dispatchWeekId: weekId,
          date: new Date(`2026-08-${String(23 + i).padStart(2, "0")}`),
          vehicleType: "CARGO_VAN",
          shiftBlock: `Bloco ${i}`,
          quantity: 1,
          createdById: supervisorId,
        },
      });
      vacancyIds.push(v.id);
    }

    const first = await runDistribution(weekId);
    expect(first.success).toBe(true);
    expect(first.result?.assignedCount).toBe(6);
    expect(first.result?.underQuotaCount).toBe(0);

    // Verify persistence.
    const persisted = await prisma.dispatchAssignment.findMany({
      where: { vacancyId: { in: vacancyIds } },
    });
    expect(persisted).toHaveLength(6);
    // Each driver got exactly 3.
    for (const profileId of driverProfileIds) {
      const count = persisted.filter((a) => a.driverProfileId === profileId).length;
      expect(count).toBe(3);
    }

    // Re-run: idempotent, still 6 assignments (previous ones replaced).
    const second = await runDistribution(weekId);
    expect(second.success).toBe(true);
    expect(second.result?.assignedCount).toBe(6);

    const persistedAfter = await prisma.dispatchAssignment.findMany({
      where: { vacancyId: { in: vacancyIds } },
    });
    expect(persistedAfter).toHaveLength(6);

    // Cleanup vacancies.
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
  });

  it("leaves vacancies unassigned when no compatible driver exists", async () => {
    // A Passenger vacancy with no Passenger driver → unassigned.
    const v = await prisma.vacancy.create({
      data: {
        dispatchWeekId: weekId,
        date: new Date("2026-08-30"),
        vehicleType: "PASSEIO",
        shiftBlock: "Bloco P",
        quantity: 1,
        createdById: supervisorId,
      },
    });

    const result = await runDistribution(weekId);
    expect(result.success).toBe(true);
    expect(result.result?.unassignedCount).toBe(1);
    expect(result.result?.unassignedVacancies.map((u) => u.id)).toContain(v.id);

    // No assignment persisted for that vacancy.
    const persisted = await prisma.dispatchAssignment.findMany({
      where: { vacancyId: v.id },
    });
    expect(persisted).toHaveLength(0);

    await prisma.vacancy.delete({ where: { id: v.id } });
  });
});
