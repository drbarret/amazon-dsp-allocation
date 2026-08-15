import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import { markInfraction } from "../actions";
import { runDistribution } from "../../dispatch/actions";

// ---------------------------------------------------------------------------
// Integration test for the behavior punishment lifecycle against a real
// Postgres database, using disposable data. Verifies:
//   - A LOSE_VACANCY punishment is FULFILLED when the driver actually receives
//     a vacancy in the effective week.
//   - A LOSE_VACANCY punishment stays ACTIVE (rolls forward) when the driver
//     receives NO vacancy in the effective week (it never expires on its own).
//   - Counts are restored afterwards (125 users, 124 driver_profiles,
//     92 ACTIVE + 41 BLOCKED allowed_emails).
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

describe.skipIf(SKIP_INTEGRATION)("behavior punishment integration", () => {
  const runId = Date.now();
  const email = `behavior-supervisor-${runId}@example.com`;

  let transportCompanyId = "";
  let supervisorId = "";
  let markedWeekId = "";
  let effectiveWeekId = "";
  let driverProfileId = "";
  let driverUserId = "";
  let dbReady = false;

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
      data: { name: `Behavior Company ${runId}` },
    });
    transportCompanyId = company.id;

    const supervisor = await prisma.user.create({
      data: {
        email,
        name: "Behavior Supervisor",
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    });
    supervisorId = supervisor.id;

    // Marked week: 2026-08-17..23 → effective week 2026-08-24..30.
    const markedWeek = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-MARK-${runId}`,
        year: 2026,
        weekNumber: 34,
        startDate: new Date("2026-08-17"),
        endDate: new Date("2026-08-23"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    markedWeekId = markedWeek.id;

    const effectiveWeek = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-EFF-${runId}`,
        year: 2026,
        weekNumber: 35,
        startDate: new Date("2026-08-24"),
        endDate: new Date("2026-08-30"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    effectiveWeekId = effectiveWeek.id;

    // One Cargo Van driver.
    const driver = await prisma.user.create({
      data: {
        email: `behavior-driver-${runId}@example.com`,
        name: "Behavior Driver",
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
    driverUserId = driver.id;
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId: driver.id },
      select: { id: true },
    });
    driverProfileId = profile.id;

    mockAuth.mockResolvedValue(session() as never);
  });

  afterAll(async () => {
    if (!dbReady) return;

    await prisma.driverInfraction.deleteMany({
      where: { driverProfileId },
    });
    await prisma.dispatchAssignment.deleteMany({
      where: { driverProfileId },
    });
    await prisma.vacancy.deleteMany({
      where: { dispatchWeekId: { in: [markedWeekId, effectiveWeekId] } },
    });
    await prisma.dispatchWeek.deleteMany({
      where: { id: { in: [markedWeekId, effectiveWeekId] } },
    });
    await prisma.user.deleteMany({ where: { id: driverUserId } });
    await prisma.user.deleteMany({ where: { id: supervisorId } });
    await prisma.transportCompany.deleteMany({ where: { id: transportCompanyId } });

    // Prove the disposable data was fully removed and production counts are
    // restored: 125 users, 124 driver_profiles, 92 ACTIVE + 41 BLOCKED.
    const users = await prisma.user.count();
    const profiles = await prisma.driverProfile.count();
    const active = await prisma.allowedEmail.count({ where: { status: "ACTIVE" } });
    const blocked = await prisma.allowedEmail.count({ where: { status: "BLOCKED" } });

    expect(users).toBe(125);
    expect(profiles).toBe(124);
    expect(active).toBe(92);
    expect(blocked).toBe(41);
  });

  beforeEach(async () => {
    if (supervisorId) {
      mockAuth.mockResolvedValue(session() as never);
    }
    // Start each test with a clean slate: no vacancies in the effective week
    // and no infractions for the driver.
    await prisma.vacancy.deleteMany({
      where: { dispatchWeekId: effectiveWeekId },
    });
    await prisma.driverInfraction.deleteMany({ where: { driverProfileId } });
  });

  it("fulfills a LOSE_VACANCY punishment when the driver receives a vacancy", async () => {
    // Mark a LOSE_VACANCY infraction on the marked week.
    const mark = await markInfraction({
      driverProfileId,
      type: "NAO_REVERTER_INSUCESSOS",
      dispatchWeekId: markedWeekId,
      observation: "integration test",
    });
    expect(mark.success).toBe(true);
    expect(mark.infraction!.status).toBe("ACTIVE");

    // Give the driver compatible vacancies in the effective week. With a
    // quotaReduction of 1 and 2 vacancies, the driver still receives 1.
    await prisma.vacancy.create({
      data: {
        dispatchWeekId: effectiveWeekId,
        date: new Date("2026-08-24"),
        vehicleType: "CARGO_VAN",
        shiftBlock: "Bloco 1",
        quantity: 1,
        createdById: supervisorId,
      },
    });
    await prisma.vacancy.create({
      data: {
        dispatchWeekId: effectiveWeekId,
        date: new Date("2026-08-25"),
        vehicleType: "CARGO_VAN",
        shiftBlock: "Bloco 2",
        quantity: 1,
        createdById: supervisorId,
      },
    });

    const dist = await runDistribution(effectiveWeekId);
    expect(dist.success).toBe(true);
    expect(dist.result?.assignedCount).toBe(1);

    // The punishment must be FULFILLED (driver actually lost a vacancy).
    const inf = await prisma.driverInfraction.findFirstOrThrow({
      where: { driverProfileId },
    });
    expect(inf.status).toBe("FULFILLED");
    expect(inf.fulfilledAt).not.toBeNull();
  });

  it("keeps a LOSE_VACANCY punishment ACTIVE when the driver receives no vacancy", async () => {
    // Mark a fresh LOSE_VACANCY infraction.
    const mark = await markInfraction({
      driverProfileId,
      type: "FALTAS_RECORRENTES",
      dispatchWeekId: markedWeekId,
      observation: "integration test 2",
    });
    expect(mark.success).toBe(true);

    // No compatible vacancy in the effective week → driver gets 0.
    // (Only a PASSEIO vacancy exists, incompatible with the Cargo Van driver.)
    await prisma.vacancy.create({
      data: {
        dispatchWeekId: effectiveWeekId,
        date: new Date("2026-08-25"),
        vehicleType: "PASSEIO",
        shiftBlock: "Bloco P",
        quantity: 1,
        createdById: supervisorId,
      },
    });

    const dist = await runDistribution(effectiveWeekId);
    expect(dist.success).toBe(true);
    expect(dist.result?.assignedCount).toBe(0);

    // The punishment must remain ACTIVE (rolled forward, not expired).
    const inf = await prisma.driverInfraction.findFirstOrThrow({
      where: { driverProfileId, type: "FALTAS_RECORRENTES" },
    });
    expect(inf.status).toBe("ACTIVE");
    expect(inf.fulfilledAt).toBeNull();
    // It rolled to the next week.
    expect(inf.effectiveStartDate.toISOString().split("T")[0]).toBe("2026-08-31");
  });
});
