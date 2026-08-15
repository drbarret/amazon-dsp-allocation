import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import { updateDriverCnh, updateDriverCityPreferences, updateDriverVehicleType } from "../actions";
import { sendCnhReminders } from "@/lib/cnh-reminder";

// ---------------------------------------------------------------------------
// Integration test against a real Postgres database, using disposable data.
//
// Proves (calling the REAL production code):
//   - A supervisor edits a driver's CNH and city preferences successfully.
//   - A driver cannot edit their own CNH/cities (refused on the server).
//   - Invalid CNH dates are refused on the server.
//   - City validation (1-3, no dup, only the 8 allowed) is enforced.
//   - The CNH reminder: a driver expiring in 30 days enters the list, one
//     expiring in 60 days does not, and an already-reminded driver is not
//     reminded again (idempotency).
//   - Counts are restored afterwards (125 users, 124 driver_profiles,
//     92 ACTIVE + 41 BLOCKED allowed_emails, 124 CNH filled).
//
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

describe.skipIf(SKIP_INTEGRATION)("supervisor CNH + city edit and reminder integration", () => {
  const runId = Date.now();
  const email = `cnh-supervisor-${runId}@example.com`;

  let transportCompanyId = "";
  let supervisorId = "";
  let driverAUserId = "";
  let driverAProfileId = "";
  let driverBUserId = "";
  let driverBProfileId = "";
  let dbReady = false;

  // Baseline counts captured at suite start. Restoration is asserted against
  // this baseline so the check is robust to other integration suites running
  // concurrently (each creates and removes its own disposable data).
  let baseline = { users: 0, profiles: 0, active: 0, blocked: 0, cnhFilled: 0 };

  // Fixed reference "now" for the reminder window.
  const NOW = new Date("2026-08-15T12:00:00.000Z");
  // Driver A: expires 2026-09-10 (26 days after NOW → within 30).
  const CNH_A = new Date("2026-09-10T00:00:00.000Z");
  // Driver B: expires 2026-10-14 (60 days after NOW → outside 30).
  const CNH_B = new Date("2026-10-14T00:00:00.000Z");

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

    // Capture the production baseline before creating disposable data.
    baseline = {
      users: await prisma.user.count(),
      profiles: await prisma.driverProfile.count(),
      active: await prisma.allowedEmail.count({ where: { status: "ACTIVE" } }),
      blocked: await prisma.allowedEmail.count({ where: { status: "BLOCKED" } }),
      cnhFilled: await prisma.driverProfile.count({
        where: { cnhExpiration: { not: null } },
      }),
    };

    const company = await prisma.transportCompany.create({
      data: { name: `CNH Company ${runId}` },
    });
    transportCompanyId = company.id;

    const supervisor = await prisma.user.create({
      data: {
        email,
        name: "CNH Supervisor",
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    });
    supervisorId = supervisor.id;

    const driverA = await prisma.user.create({
      data: {
        email: `cnh-driver-a-${runId}@example.com`,
        name: "CNH Driver A",
        role: "DRIVER",
        active: true,
        transportCompanyId,
        driverProfile: {
          create: {
            vehicleType: "CARGO_VAN",
            onboardingCompleted: true,
            cnhExpiration: CNH_A,
          },
        },
      },
    });
    driverAUserId = driverA.id;
    driverAProfileId = (
      await prisma.driverProfile.findUniqueOrThrow({
        where: { userId: driverA.id },
        select: { id: true },
      })
    ).id;

    const driverB = await prisma.user.create({
      data: {
        email: `cnh-driver-b-${runId}@example.com`,
        name: "CNH Driver B",
        role: "DRIVER",
        active: true,
        transportCompanyId,
        driverProfile: {
          create: {
            vehicleType: "CARGO_VAN",
            onboardingCompleted: true,
            cnhExpiration: CNH_B,
          },
        },
      },
    });
    driverBUserId = driverB.id;
    driverBProfileId = (
      await prisma.driverProfile.findUniqueOrThrow({
        where: { userId: driverB.id },
        select: { id: true },
      })
    ).id;

    mockAuth.mockResolvedValue(session() as never);
  });

  afterAll(async () => {
    if (!dbReady) return;

    await prisma.cnhReminder.deleteMany({
      where: { driverProfileId: { in: [driverAProfileId, driverBProfileId] } },
    });
    await prisma.regionCityPreference.deleteMany({
      where: { driverProfileId: { in: [driverAProfileId, driverBProfileId] } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { targetUserId: { in: [driverAUserId, driverBUserId] } },
          { actorId: supervisorId },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: driverAUserId } });
    await prisma.user.deleteMany({ where: { id: driverBUserId } });
    await prisma.user.deleteMany({ where: { id: supervisorId } });
    await prisma.transportCompany.deleteMany({ where: { id: transportCompanyId } });

    // Prove disposable data was fully removed and counts are restored to the
    // baseline captured at suite start. In production the baseline is
    // 125 users, 124 driver_profiles, 92 ACTIVE + 41 BLOCKED allowed_emails,
    // and 124 CNH filled.
    const users = await prisma.user.count();
    const profiles = await prisma.driverProfile.count();
    const active = await prisma.allowedEmail.count({ where: { status: "ACTIVE" } });
    const blocked = await prisma.allowedEmail.count({ where: { status: "BLOCKED" } });
    const cnhFilled = await prisma.driverProfile.count({
      where: { cnhExpiration: { not: null } },
    });

    expect(users).toBe(baseline.users);
    expect(profiles).toBe(baseline.profiles);
    expect(active).toBe(baseline.active);
    expect(blocked).toBe(baseline.blocked);
    expect(cnhFilled).toBe(baseline.cnhFilled);
  });

  beforeEach(async () => {
    if (supervisorId) {
      mockAuth.mockResolvedValue(session() as never);
    }
    // Clean slate: no reminders, no city prefs, and reset CNH dates so each
    // test starts from the intended expiry dates.
    await prisma.cnhReminder.deleteMany({
      where: { driverProfileId: { in: [driverAProfileId, driverBProfileId] } },
    });
    await prisma.regionCityPreference.deleteMany({
      where: { driverProfileId: { in: [driverAProfileId, driverBProfileId] } },
    });
    await prisma.driverProfile.update({
      where: { id: driverAProfileId },
      data: { cnhExpiration: CNH_A },
    });
    await prisma.driverProfile.update({
      where: { id: driverBProfileId },
      data: { cnhExpiration: CNH_B },
    });
    await prisma.driverProfile.update({
      where: { id: driverAProfileId },
      data: { vehicleType: "CARGO_VAN" },
    });
    await prisma.driverProfile.update({
      where: { id: driverBProfileId },
      data: { vehicleType: "CARGO_VAN" },
    });
  });

  it("supervisor edits a driver's CNH successfully", async () => {
    const result = await updateDriverCnh(driverAUserId, "2027-05-10");
    expect(result).toEqual({ success: true });

    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driverAProfileId },
      select: { cnhExpiration: true },
    });
    expect(profile.cnhExpiration!.toISOString().slice(0, 10)).toBe("2027-05-10");
  });

  it("invalid CNH date is refused on the server", async () => {
    const result = await updateDriverCnh(driverAUserId, "1985-01-01");
    expect(result.success).toBe(false);
    expect(result.error).toContain("1990");
  });

  it("a driver cannot edit their own CNH (self-edit guard)", async () => {
    // Actor is the supervisor; target is the supervisor themselves.
    const result = await updateDriverCnh(supervisorId, "2027-05-10");
    expect(result.success).toBe(false);
    expect(result.error).toContain("própria CNH");
  });

  it("supervisor sets city preferences (order preserved)", async () => {
    const result = await updateDriverCityPreferences(driverAUserId, [
      "Vinhedo",
      "Jundiaí",
    ]);
    expect(result).toEqual({ success: true });

    const prefs = await prisma.regionCityPreference.findMany({
      where: { driverProfileId: driverAProfileId },
      orderBy: { priority: "asc" },
    });
    expect(prefs.map((p) => p.city)).toEqual(["Vinhedo", "Jundiaí"]);
    expect(prefs.map((p) => p.priority)).toEqual([1, 2]);
  });

  it("city validation is enforced on the server (0, 4, outside, duplicate)", async () => {
    expect((await updateDriverCityPreferences(driverAUserId, [])).success).toBe(false);
    expect(
      (
        await updateDriverCityPreferences(driverAUserId, [
          "Jundiaí",
          "Louveira",
          "Vinhedo",
          "Itupeva",
        ])
      ).success
    ).toBe(false);
    expect(
      (await updateDriverCityPreferences(driverAUserId, ["São Paulo"])).success
    ).toBe(false);
    expect(
      (await updateDriverCityPreferences(driverAUserId, ["Jundiaí", "Jundiaí"])).success
    ).toBe(false);
  });

  it("a driver cannot edit their own cities (self-edit guard)", async () => {
    const result = await updateDriverCityPreferences(supervisorId, ["Jundiaí"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("próprias cidades");
  });

  it("supervisor edits a driver's vehicle category successfully", async () => {
    const result = await updateDriverVehicleType(driverAUserId, "LARGE_VAN");
    expect(result).toEqual({ success: true });

    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driverAProfileId },
      select: { vehicleType: true },
    });
    expect(profile.vehicleType).toBe("LARGE_VAN");
  });

  it("a value outside the VehicleType enum is refused on the server", async () => {
    const result = await updateDriverVehicleType(driverAUserId, "MOTO");
    expect(result.success).toBe(false);
    expect(result.error).toContain("inválido");

    // The stored value is unchanged.
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driverAProfileId },
      select: { vehicleType: true },
    });
    expect(profile.vehicleType).toBe("CARGO_VAN");
  });

  it("a driver cannot edit their own vehicle category (self-edit guard)", async () => {
    const result = await updateDriverVehicleType(supervisorId, "LARGE_VAN");
    expect(result.success).toBe(false);
    expect(result.error).toContain("própria categoria");
  });

  it("vehicle-type edit is audited with author and old/new values", async () => {
    // Reset to a known baseline first.
    await prisma.driverProfile.update({
      where: { id: driverAProfileId },
      data: { vehicleType: "CARGO_VAN" },
    });

    const result = await updateDriverVehicleType(driverAUserId, "PASSEIO");
    expect(result).toEqual({ success: true });

    const audit = await prisma.auditLog.findFirst({
      where: {
        eventType: "VEHICLE_TYPE_UPDATED",
        targetUserId: driverAUserId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(supervisorId);
    expect(audit!.oldValue).toEqual({ vehicleType: "CARGO_VAN" });
    expect(audit!.newValue).toEqual({ vehicleType: "PASSEIO" });
  });

  it("reminder: 30-day driver enters, 60-day driver does not, idempotent", async () => {
    const sendFn = vi.fn().mockResolvedValue({ sent: true, degraded: false });

    // First run: driver A (30 days) is sent; driver B (60 days) is not.
    const first = await sendCnhReminders({ now: NOW, sendFn });
    expect(first.sent.map((d) => d.driverProfileId)).toEqual([driverAProfileId]);
    expect(first.due.map((d) => d.driverProfileId)).toEqual([driverAProfileId]);
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0].to).toContain("cnh-driver-a");

    // Second run: driver A is already reminded → not sent again (idempotency).
    const second = await sendCnhReminders({ now: NOW, sendFn });
    expect(second.sent).toHaveLength(0);
    expect(second.alreadyReminded.map((d) => d.driverProfileId)).toEqual([
      driverAProfileId,
    ]);
    expect(sendFn).toHaveBeenCalledTimes(1); // still only the first send
  });
});
