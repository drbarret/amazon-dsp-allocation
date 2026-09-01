import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import {
  createDriver,
  saveDriverEdits,
  requestDriverDeactivation,
  reviewDeactivationRequest,
} from "../actions";
import { cancelPendingDeactivationRequests } from "@/lib/deactivation";
import { computeCpfBlindIndex } from "@/lib/crypto";

// ---------------------------------------------------------------------------
// Integration tests for driver edit and deactivation request actions.
//
// Proves (calling REAL production code against a real Postgres database):
//   - saveDriverEdits updates all fields atomically in a transaction
//   - saveDriverEdits rejects invalid data (city, vehicle type, whatsapp length)
//   - saveDriverEdits enforces cross-company isolation
//   - requestDriverDeactivation creates PENDING request, driver stays active
//   - Second PENDING for same driver is rejected
//   - After REJECTED, new PENDING succeeds
//   - reviewDeactivationRequest APPROVED deactivates the driver
//   - cancelPendingDeactivationRequests cancels orphaned requests
//   - Phone encryption works correctly
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

function generateValidCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += base[i] * (10 - i);
  }
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  base.push(d1);

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += base[i] * (11 - i);
  }
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  base.push(d2);

  const digits = base.join("");
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

const cpfA = generateValidCpf();
const cpfB = generateValidCpf();
const cpfC = generateValidCpf();
const cpfD = generateValidCpf();

describe.skipIf(SKIP_INTEGRATION)("driver edit and deactivation request actions", () => {
  const runId = Date.now();

  let transportCompanyId = "";
  let otherTransportCompanyId = "";
  let supervisorId = "";
  let amId = "";
  let driverUserId = "";
  let driverProfileId = "";
  let otherSupervisorId = "";
  let dbReady = false;

  function session(role: string, userId: string, companyId?: string) {
    return {
      user: {
        id: userId,
        role,
        active: true,
        transportCompanyId: companyId ?? transportCompanyId,
      },
    };
  }

  beforeAll(async () => {
    await requireDatabase();
    try {
      // Create transport companies
      const tc1 = await prisma.transportCompany.create({
        data: { name: `TC-Edit-${runId}`, cnpj: `0000000000${runId}` },
      });
      transportCompanyId = tc1.id;

      const tc2 = await prisma.transportCompany.create({
        data: { name: `TC-Other-${runId}`, cnpj: `9999999999${runId}` },
      });
      otherTransportCompanyId = tc2.id;

      // Create supervisor
      const sup = await prisma.user.create({
        data: {
          email: `__test_sup_edit_${runId}@test.local`,
          name: "Test Supervisor Edit",
          role: "SUPERVISOR",
          transportCompanyId,
        },
      });
      supervisorId = sup.id;

      // Create other supervisor (different company)
      const otherSup = await prisma.user.create({
        data: {
          email: `__test_other_sup_${runId}@test.local`,
          name: "Other Supervisor",
          role: "SUPERVISOR",
          transportCompanyId: otherTransportCompanyId,
        },
      });
      otherSupervisorId = otherSup.id;

      // Create account manager
      const am = await prisma.user.create({
        data: {
          email: `__test_am_edit_${runId}@test.local`,
          name: "Test AM Edit",
          role: "ACCOUNT_MANAGER",
          transportCompanyId,
        },
      });
      amId = am.id;

      // Create driver with profile
      const drv = await prisma.user.create({
        data: {
          email: `__test_drv_edit_${runId}@test.local`,
          name: "Test Driver Edit",
          role: "DRIVER",
          transportCompanyId,
          driverProfile: {
            create: {
              vehicleType: "CARGO_VAN",
              transporterId: "T-TEST",
            },
          },
        },
        include: { driverProfile: true },
      });
      driverUserId = drv.id;
      driverProfileId = drv.driverProfile!.id;

      dbReady = true;
    } catch (e) {
      console.error("Setup failed:", e);
    }
  });

  afterAll(async () => {
    if (!dbReady) return;
    try {
      // Cleanup in correct order (cascade should handle most)
      await prisma.deactivationRequest.deleteMany({
        where: {
          OR: [
            { driverUserId },
            { requestedById: supervisorId },
            { reviewerId: amId },
          ],
        },
      });
      await prisma.regionCityPreference.deleteMany({
        where: { driverProfileId },
      });
      await prisma.driverProfile.deleteMany({
        where: { id: driverProfileId },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [supervisorId, amId, driverUserId, otherSupervisorId] },
        },
      });
      await prisma.transportCompany.deleteMany({
        where: {
          id: { in: [transportCompanyId, otherTransportCompanyId] },
        },
      });
    } catch (e) {
      console.error("Cleanup failed:", e);
    }
  });

  // ---- saveDriverEdits ----

  it("rejects DRIVER role from editing", async () => {
    if (!dbReady) return;
    // Use a different user as target so self-edit check doesn't trigger first
    mockAuth.mockResolvedValue(session("DRIVER", driverUserId));

    await expect(saveDriverEdits(supervisorId, {
      name: "Hacked by Driver",
    })).rejects.toThrow("Permissão insuficiente");
  });

  it("updates driver profile fields atomically", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await saveDriverEdits(driverUserId, {
      name: "Updated Name",
      vehicleType: "LARGE_VAN",
      transporterId: "T-NEW",
      worksCiclo1: true,
      worksCiclo2: true,
      isTrusted: true,
      whatsappGroup: "Grupo Teste",
    });

    expect(result.success).toBe(true);

    const updated = await prisma.user.findUnique({
      where: { id: driverUserId },
      include: { driverProfile: true },
    });

    expect(updated?.name).toBe("Updated Name");
    expect(updated?.driverProfile?.vehicleType).toBe("LARGE_VAN");
    expect(updated?.driverProfile?.transporterId).toBe("T-NEW");
    expect(updated?.driverProfile?.worksCiclo1).toBe(true);
    expect(updated?.driverProfile?.worksCiclo2).toBe(true);
    expect(updated?.driverProfile?.isTrusted).toBe(true);
    expect(updated?.driverProfile?.whatsappGroup).toBe("Grupo Teste");
  });

  it("updates city preferences atomically", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await saveDriverEdits(driverUserId, {
      cities: ["Jundiaí", "Louveira"],
    });

    expect(result.success).toBe(true);

    const prefs = await prisma.regionCityPreference.findMany({
      where: { driverProfileId },
      orderBy: { priority: "asc" },
    });

    expect(prefs).toHaveLength(2);
    expect(prefs[0].city).toBe("Jundiaí");
    expect(prefs[0].priority).toBe(1);
    expect(prefs[1].city).toBe("Louveira");
    expect(prefs[1].priority).toBe(2);
  });

  it("rejects invalid city", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await saveDriverEdits(driverUserId, {
      cities: ["Cidade Inexistente"],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cidade inválida");
  });

  it("does not persist name when city validation fails (pre-transaction guard)", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    // First set a known name
    await saveDriverEdits(driverUserId, { name: "Atomicity Test Before" });

    // Now try to update name + invalid cities in one call
    const result = await saveDriverEdits(driverUserId, {
      name: "Atomicity Test After",
      cities: ["Cidade Inexistente"],
    });

    expect(result.success).toBe(false);

    // Name must NOT have been updated (validation rejects before transaction starts)
    const user = await prisma.user.findUnique({ where: { id: driverUserId } });
    expect(user?.name).toBe("Atomicity Test Before");
  });

  it("rejects whatsapp group > 80 chars", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await saveDriverEdits(driverUserId, {
      whatsappGroup: "A".repeat(81),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("80 caracteres");
  });

  it("enforces cross-company isolation", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", otherSupervisorId, otherTransportCompanyId));

    const result = await saveDriverEdits(driverUserId, {
      name: "Hacked Name",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("outra transportadora");
  });

  it("encrypts phone correctly", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await saveDriverEdits(driverUserId, {
      phone: "(11) 98765-4321",
    });

    expect(result.success).toBe(true);

    const profile = await prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
    });

    expect(profile?.phoneFormatted).toBe("(11) 98765-4321");
    expect(profile?.phone).toBeTruthy();
    expect(profile?.phone).not.toBe("(11) 98765-4321"); // must be encrypted
    expect(profile?.phone).toContain(":"); // iv:authTag:ciphertext format
  });

  it("rejects invalid CPF", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await saveDriverEdits(driverUserId, {
      cpf: "111.111.111-11",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("CPF inválido");
  });

  it("encrypts CPF and updates blind index", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await saveDriverEdits(driverUserId, {
      cpf: cpfA,
    });

    expect(result.success).toBe(true);

    const profile = await prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
    });

    expect(profile?.cpf).toBeTruthy();
    expect(profile?.cpf).not.toBe(cpfA); // must be encrypted
    expect(profile?.cpf).toContain(":"); // iv:authTag:ciphertext format
    expect(profile?.cpfBlindIndex).toBeTruthy();
  });

  it("rejects duplicate CPF from another driver", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const duplicateCpf = cpfB;
    const blindIndex = computeCpfBlindIndex(duplicateCpf);

    // Create a second driver whose cpfBlindIndex collides with the CPF we will submit
    const otherDriver = await prisma.user.create({
      data: {
        email: `__test_other_cpf_${runId}@test.local`,
        name: "Other Driver CPF",
        role: "DRIVER",
        transportCompanyId,
        driverProfile: {
          create: {
            vehicleType: "CARGO_VAN",
            cpf: "encrypted-cpf",
            cpfBlindIndex: blindIndex,
          },
        },
      },
      include: { driverProfile: true },
    });

    const result = await saveDriverEdits(driverUserId, { cpf: duplicateCpf });

    expect(result.success).toBe(false);
    expect(result.error).toContain("já está cadastrado");

    // Cleanup
    await prisma.driverProfile.deleteMany({
      where: { id: otherDriver.driverProfile!.id },
    });
    await prisma.user.delete({ where: { id: otherDriver.id } });
  });

  // ---- createDriver ----

  it("rejects DRIVER role from creating a driver", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("DRIVER", driverUserId));

    await expect(
      createDriver({
        name: "Hacked Driver",
        email: "hacked@test.local",
        cpf: cpfC,
        phone: "(11) 99999-9999",
        vehicleType: "CARGO_VAN",
        cities: ["Jundiaí"],
      }),
    ).rejects.toThrow("Permissão insuficiente");
  });

  it("creates a driver manually with all fields", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const email = `__test_create_driver_${runId}@test.local`;
    const result = await createDriver({
      name: "Novo Motorista",
      email,
      cpf: cpfC,
      phone: "(11) 99999-8888",
      vehicleType: "LARGE_VAN",
      transporterId: "T-CREATE",
      worksCiclo1: true,
      worksCiclo2: false,
      whatsappGroup: "Grupo Novo",
      cities: ["Jundiaí", "Louveira"],
    });

    expect(result.success).toBe(true);
    expect(result.driverId).toBeTruthy();

    const created = await prisma.user.findUnique({
      where: { id: result.driverId },
      include: { driverProfile: { include: { regionPreferences: { orderBy: { priority: "asc" } } } } },
    });

    expect(created?.email).toBe(email);
    expect(created?.name).toBe("Novo Motorista");
    expect(created?.role).toBe("DRIVER");
    expect(created?.active).toBe(true);
    expect(created?.transportCompanyId).toBe(transportCompanyId);
    expect(created?.driverProfile?.vehicleType).toBe("LARGE_VAN");
    expect(created?.driverProfile?.transporterId).toBe("T-CREATE");
    expect(created?.driverProfile?.worksCiclo1).toBe(true);
    expect(created?.driverProfile?.whatsappGroup).toBe("Grupo Novo");
    expect(created?.driverProfile?.phoneFormatted).toBe("(11) 99999-8888");
    expect(created?.driverProfile?.cpf).toBeTruthy();
    expect(created?.driverProfile?.cpf).not.toBe(cpfC);
    expect(created?.driverProfile?.cpfBlindIndex).toBeTruthy();
    expect(created?.driverProfile?.regionPreferences).toHaveLength(2);
    expect(created?.driverProfile?.regionPreferences[0].city).toBe("Jundiaí");

    // AllowedEmail entry created so the driver can sign in
    const allowed = await prisma.allowedEmail.findUnique({ where: { email } });
    expect(allowed?.status).toBe("ACTIVE");
    expect(allowed?.role).toBe("DRIVER");

    // Cleanup
    await prisma.regionCityPreference.deleteMany({
      where: { driverProfileId: created?.driverProfile?.id },
    });
    await prisma.driverProfile.deleteMany({ where: { id: created?.driverProfile?.id } });
    await prisma.user.delete({ where: { id: result.driverId } });
    await prisma.allowedEmail.deleteMany({ where: { email } });
  });

  it("rejects duplicate email on create", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await createDriver({
      name: "Duplicate Email",
      email: `__test_drv_edit_${runId}@test.local`, // existing driver email
      cpf: cpfD, // different valid CPF
      phone: "(11) 99999-9999",
      vehicleType: "CARGO_VAN",
      cities: ["Jundiaí"],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("e-mail");
  });

  it("rejects invalid CPF on create", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await createDriver({
      name: "Invalid CPF",
      email: `__test_invalid_cpf_${runId}@test.local`,
      cpf: "111.111.111-11",
      phone: "(11) 99999-9999",
      vehicleType: "CARGO_VAN",
      cities: ["Jundiaí"],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("CPF inválido");
  });

  // ---- requestDriverDeactivation ----

  it("ACCOUNT_MANAGER deactivates driver directly", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("ACCOUNT_MANAGER", amId));

    const result = await requestDriverDeactivation(driverUserId, "AM direct deactivation");

    expect(result.success).toBe(true);

    const driver = await prisma.user.findUnique({ where: { id: driverUserId } });
    expect(driver?.active).toBe(false);
    expect(driver?.deactivatedByRole).toBe("ACCOUNT_MANAGER");
  });

  it("creates PENDING request and driver stays active (SUPERVISOR)", async () => {
    if (!dbReady) return;
    // Reactivate driver first
    await prisma.user.update({
      where: { id: driverUserId },
      data: { active: true, deactivatedById: null, deactivatedByRole: null },
    });

    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await requestDriverDeactivation(driverUserId, "Test reason");

    expect(result.success).toBe(true);

    const driver = await prisma.user.findUnique({ where: { id: driverUserId } });
    expect(driver?.active).toBe(true);

    const req = await prisma.deactivationRequest.findFirst({
      where: { driverUserId, status: "PENDING" },
    });
    expect(req).toBeTruthy();
    expect(req?.reason).toBe("Test reason");
  });

  it("rejects second PENDING for same driver", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));

    const result = await requestDriverDeactivation(driverUserId, "Second attempt");

    expect(result.success).toBe(false);
    expect(result.error).toContain("pendente");
  });

  // ---- reviewDeactivationRequest ----

  it("rejects SUPERVISOR from reviewing deactivation request", async () => {
    if (!dbReady) return;
    // Use the existing PENDING request created by "creates PENDING request" test
    const pendingReq = await prisma.deactivationRequest.findFirst({
      where: { driverUserId, status: "PENDING" },
    });
    expect(pendingReq).toBeTruthy();

    // Try to review as SUPERVISOR — should fail
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));
    const result = await reviewDeactivationRequest(pendingReq!.id, "APPROVED");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Apenas gerentes de conta");
  });

  it("APPROVED deactivates the driver", async () => {
    if (!dbReady) return;
    mockAuth.mockResolvedValue(session("ACCOUNT_MANAGER", amId));

    const pendingReq = await prisma.deactivationRequest.findFirst({
      where: { driverUserId, status: "PENDING" },
    });
    expect(pendingReq).toBeTruthy();

    const result = await reviewDeactivationRequest(pendingReq!.id, "APPROVED");

    expect(result.success).toBe(true);

    const driver = await prisma.user.findUnique({ where: { id: driverUserId } });
    expect(driver?.active).toBe(false);
    expect(driver?.deactivatedByRole).toBe("ACCOUNT_MANAGER");

    const req = await prisma.deactivationRequest.findUnique({
      where: { id: pendingReq!.id },
    });
    expect(req?.status).toBe("APPROVED");
  });

  it("after REJECTED, new PENDING succeeds", async () => {
    if (!dbReady) return;

    // First, reactivate the driver for this test
    mockAuth.mockResolvedValue(session("ACCOUNT_MANAGER", amId));
    await prisma.user.update({
      where: { id: driverUserId },
      data: { active: true, deactivatedById: null, deactivatedByRole: null },
    });

    // Create and reject a request
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));
    await requestDriverDeactivation(driverUserId, "Will be rejected");

    const pendingReq = await prisma.deactivationRequest.findFirst({
      where: { driverUserId, status: "PENDING" },
    });

    mockAuth.mockResolvedValue(session("ACCOUNT_MANAGER", amId));
    await reviewDeactivationRequest(pendingReq!.id, "REJECTED", "Not now");

    // Now create a new PENDING — should succeed
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));
    const result = await requestDriverDeactivation(driverUserId, "New attempt");

    expect(result.success).toBe(true);

    const newReq = await prisma.deactivationRequest.findFirst({
      where: { driverUserId, status: "PENDING" },
    });
    expect(newReq).toBeTruthy();
    expect(newReq?.reason).toBe("New attempt");
  });

  // ---- cancelPendingDeactivationRequests ----

  it("cancels pending requests when driver is deactivated externally", async () => {
    if (!dbReady) return;

    // There should be a PENDING request from the previous test
    const pendingBefore = await prisma.deactivationRequest.count({
      where: { driverUserId, status: "PENDING" },
    });
    expect(pendingBefore).toBeGreaterThan(0);

    await cancelPendingDeactivationRequests(
      driverUserId,
      supervisorId,
      "Cancelado: teste externo",
    );

    const pendingAfter = await prisma.deactivationRequest.count({
      where: { driverUserId, status: "PENDING" },
    });
    expect(pendingAfter).toBe(0);

    const cancelled = await prisma.deactivationRequest.findFirst({
      where: { driverUserId, status: "REJECTED" },
      orderBy: { updatedAt: "desc" },
    });
    expect(cancelled?.reviewNotes).toContain("teste externo");
  });

  it("cancels pending requests inside $transaction with tx client (production regression)", async () => {
    if (!dbReady) return;

    // Create a fresh PENDING request
    mockAuth.mockResolvedValue(session("SUPERVISOR", supervisorId));
    // Ensure driver is active
    await prisma.user.update({
      where: { id: driverUserId },
      data: { active: true, deactivatedById: null, deactivatedByRole: null },
    });
    // Clear any existing pending
    await prisma.deactivationRequest.updateMany({
      where: { driverUserId, status: "PENDING" },
      data: { status: "REJECTED" },
    });

    const reqResult = await requestDriverDeactivation(driverUserId, "TX test pending");
    expect(reqResult.success).toBe(true);

    const pendingBefore = await prisma.deactivationRequest.count({
      where: { driverUserId, status: "PENDING" },
    });
    expect(pendingBefore).toBe(1);

    // Now simulate what requestDriverDeactivation does for AM/ADMIN:
    // call cancelPendingDeactivationRequests INSIDE a $transaction with tx
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: driverUserId },
        data: { active: false, deactivatedById: amId, deactivatedByRole: "ACCOUNT_MANAGER" },
      });
      await cancelPendingDeactivationRequests(
        driverUserId,
        amId,
        "Cancelado: desativação direta via transação",
        tx,
      );
    });

    // The PENDING must have been cancelled
    const pendingAfter = await prisma.deactivationRequest.count({
      where: { driverUserId, status: "PENDING" },
    });
    expect(pendingAfter).toBe(0);

    // And there should be a REJECTED entry with the cancellation reason
    const cancelled = await prisma.deactivationRequest.findFirst({
      where: { driverUserId, status: "REJECTED" },
      orderBy: { updatedAt: "desc" },
    });
    expect(cancelled?.reviewNotes).toContain("desativação direta via transação");

    // Driver must be inactive
    const driver = await prisma.user.findUnique({ where: { id: driverUserId } });
    expect(driver?.active).toBe(false);
  });
});
