import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import { runDistribution } from "../actions";

// ---------------------------------------------------------------------------
// Integration test for CYCLE-BASED recidivism escalation against a real
// Postgres database, using disposable data. Verifies the real production path
// (runDistribution) escalates a pending recidivism warning when a new
// distribution cycle runs:
//   - pending (supervisor notified, driver still active) + new cycle → escalates;
//   - decided (driver deactivated) + new cycle → does NOT escalate;
//   - two consecutive cycles → does NOT escalate the same infraction twice.
// The database is MANDATORY: if unreachable the suite FAILS HIGH. The only
// legitimate skip is SKIP_INTEGRATION_TESTS=1 (CI has no database).
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

describe.skipIf(SKIP_INTEGRATION)("cycle-based recidivism escalation integration", () => {
  const runId = Date.now();
  const email = `escalation-supervisor-${runId}@example.com`;

  let transportCompanyId = "";
  let supervisorId = "";
  let weekAId = "";
  let weekBId = "";
  let activeDriverProfileId = "";
  let activeDriverUserId = "";
  let inactiveDriverProfileId = "";
  let inactiveDriverUserId = "";
  let dbReady = false;

  let baseline = { users: 0, profiles: 0, infractions: 0 };

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

    baseline = {
      users: await prisma.user.count(),
      profiles: await prisma.driverProfile.count(),
      infractions: await prisma.driverInfraction.count(),
    };

    const company = await prisma.transportCompany.create({
      data: { name: `Escalation Company ${runId}` },
    });
    transportCompanyId = company.id;

    const supervisor = await prisma.user.create({
      data: {
        email,
        name: "Escalation Supervisor",
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    });
    supervisorId = supervisor.id;

    // Two consecutive distribution cycles.
    const weekA = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-ESC-A-${runId}`,
        year: 2026,
        weekNumber: 40,
        startDate: new Date("2026-09-28"),
        endDate: new Date("2026-10-04"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    weekAId = weekA.id;

    const weekB = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-ESC-B-${runId}`,
        year: 2026,
        weekNumber: 41,
        startDate: new Date("2026-10-05"),
        endDate: new Date("2026-10-11"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    weekBId = weekB.id;

    // Active driver (supervisor has NOT decided).
    const activeDriver = await prisma.user.create({
      data: {
        email: `escalation-active-${runId}@example.com`,
        name: "Escalation Active Driver",
        role: "DRIVER",
        active: true,
        transportCompanyId,
        driverProfile: {
          create: { vehicleType: "CARGO_VAN", onboardingCompleted: true },
        },
      },
    });
    activeDriverUserId = activeDriver.id;
    const activeProfile = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId: activeDriver.id },
      select: { id: true },
    });
    activeDriverProfileId = activeProfile.id;

    // Inactive driver (supervisor DECIDED by deactivating).
    const inactiveDriver = await prisma.user.create({
      data: {
        email: `escalation-inactive-${runId}@example.com`,
        name: "Escalation Inactive Driver",
        role: "DRIVER",
        active: false,
        transportCompanyId,
        driverProfile: {
          create: { vehicleType: "CARGO_VAN", onboardingCompleted: true },
        },
      },
    });
    inactiveDriverUserId = inactiveDriver.id;
    const inactiveProfile = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId: inactiveDriver.id },
      select: { id: true },
    });
    inactiveDriverProfileId = inactiveProfile.id;

    mockAuth.mockResolvedValue(session() as never);
  });

  afterAll(async () => {
    if (!dbReady) return;

    await prisma.driverInfraction.deleteMany({
      where: {
        driverProfileId: { in: [activeDriverProfileId, inactiveDriverProfileId] },
      },
    });
    await prisma.dispatchAssignment.deleteMany({
      where: {
        driverProfileId: { in: [activeDriverProfileId, inactiveDriverProfileId] },
      },
    });
    await prisma.vacancy.deleteMany({
      where: { dispatchWeekId: { in: [weekAId, weekBId] } },
    });
    await prisma.dispatchWeek.deleteMany({
      where: { id: { in: [weekAId, weekBId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [activeDriverUserId, inactiveDriverUserId] } },
    });
    await prisma.user.deleteMany({ where: { id: supervisorId } });
    await prisma.transportCompany.deleteMany({ where: { id: transportCompanyId } });

    // Prove disposable data was fully removed and counts restored to baseline.
    const users = await prisma.user.count();
    const profiles = await prisma.driverProfile.count();
    const infractions = await prisma.driverInfraction.count();
    expect(users).toBe(baseline.users);
    expect(profiles).toBe(baseline.profiles);
    expect(infractions).toBe(baseline.infractions);
  });

  beforeEach(async () => {
    if (supervisorId) {
      mockAuth.mockResolvedValue(session() as never);
    }
    // Clean slate: no infractions for either driver.
    await prisma.driverInfraction.deleteMany({
      where: {
        driverProfileId: { in: [activeDriverProfileId, inactiveDriverProfileId] },
      },
    });
  });

  it("escalates a pending recidivism warning when a new cycle runs", async () => {
    // Supervisor was notified (recidivism warning) but has not decided.
    const inf = await prisma.driverInfraction.create({
      data: {
        driverProfileId: activeDriverProfileId,
        type: "NAO_REVERTER_INSUCESSOS",
        weekKey: "WK-ESC-A",
        effectiveWeekKey: "WK-ESC-A",
        effectiveStartDate: new Date("2026-09-28"),
        effectiveEndDate: new Date("2026-10-04"),
        status: "ACTIVE",
        multiplier: 2,
        supervisorNotifiedAt: new Date(),
      },
    });

    const dist = await runDistribution(weekAId);
    expect(dist.success).toBe(true);

    const after = await prisma.driverInfraction.findUniqueOrThrow({
      where: { id: inf.id },
    });
    expect(after.escalatedAt).not.toBeNull();
  });

  it("does NOT escalate twice across two consecutive cycles", async () => {
    const inf = await prisma.driverInfraction.create({
      data: {
        driverProfileId: activeDriverProfileId,
        type: "FALTAS_RECORRENTES",
        weekKey: "WK-ESC-A",
        effectiveWeekKey: "WK-ESC-A",
        effectiveStartDate: new Date("2026-09-28"),
        effectiveEndDate: new Date("2026-10-04"),
        status: "ACTIVE",
        multiplier: 2,
        supervisorNotifiedAt: new Date(),
      },
    });

    // First cycle escalates.
    await runDistribution(weekAId);
    const afterFirst = await prisma.driverInfraction.findUniqueOrThrow({
      where: { id: inf.id },
    });
    expect(afterFirst.escalatedAt).not.toBeNull();
    const firstEscalatedAt = afterFirst.escalatedAt!.getTime();

    // Second (next) cycle must NOT escalate again.
    await runDistribution(weekBId);
    const afterSecond = await prisma.driverInfraction.findUniqueOrThrow({
      where: { id: inf.id },
    });
    expect(afterSecond.escalatedAt!.getTime()).toBe(firstEscalatedAt);
  });

  it("does NOT escalate when the supervisor decided (driver deactivated)", async () => {
    const inf = await prisma.driverInfraction.create({
      data: {
        driverProfileId: inactiveDriverProfileId,
        type: "ABANDONO_ROTA",
        weekKey: "WK-ESC-A",
        effectiveWeekKey: "WK-ESC-A",
        effectiveStartDate: new Date("2026-09-28"),
        effectiveEndDate: new Date("2026-10-04"),
        status: "ACTIVE",
        multiplier: 2,
        supervisorNotifiedAt: new Date(),
      },
    });

    await runDistribution(weekAId);

    const after = await prisma.driverInfraction.findUniqueOrThrow({
      where: { id: inf.id },
    });
    // The driver is deactivated → the supervisor decided → no escalation.
    expect(after.escalatedAt).toBeNull();
  });
});
