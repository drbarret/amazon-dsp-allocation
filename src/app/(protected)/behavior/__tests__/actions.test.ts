import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Behavior server-action tests against the REAL production code in
// src/app/(protected)/behavior/actions.ts. We mock auth() and prisma (no real
// DB) and assert the authorization + workflow rules from the spec:
//   - RECLAMACAO_ASPERA (subjective) requires account-manager approval.
//   - The other 4 types are active immediately.
//   - The punishment applies the week AFTER the mark.
//   - Recidivism doubles the punishment and notifies the supervisor.
// ---------------------------------------------------------------------------

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
  driverProfile: {
    findUnique: vi.fn(),
  },
  dispatchWeek: {
    findUnique: vi.fn(),
  },
  driverInfraction: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const {
  markInfraction,
  approveInfraction,
  rejectInfraction,
} = await import("@/app/(protected)/behavior/actions");

beforeEach(() => {
  vi.clearAllMocks();
});

function supervisorSession() {
  return { user: { id: "sup-1", role: "SUPERVISOR", active: true } };
}

function managerSession() {
  return { user: { id: "mgr-1", role: "ACCOUNT_MANAGER", active: true } };
}

function setupCommon() {
  mockAuth.mockResolvedValue(supervisorSession() as never);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: "sup-1",
    transportCompanyId: "tc-1",
  });
  mockPrisma.driverProfile.findUnique.mockResolvedValue({
    id: "driver-1",
    userId: "user-driver-1",
    user: { transportCompanyId: "tc-1", active: true },
  });
  mockPrisma.dispatchWeek.findUnique.mockResolvedValue({
    id: "week-1",
    transportCompanyId: "tc-1",
    weekKey: "WK-33",
    startDate: new Date("2026-08-17"),
    endDate: new Date("2026-08-23"),
  });
  mockPrisma.driverInfraction.count.mockResolvedValue(0);
  mockPrisma.driverInfraction.findFirst.mockResolvedValue(null);
}

const baseInput = {
  driverProfileId: "driver-1",
  dispatchWeekId: "week-1",
  observation: "",
};

describe("markInfraction — approval workflow", () => {
  it("RECLAMACAO_ASPERA (subjetivo) starts PENDING_APPROVAL, not ACTIVE", async () => {
    setupCommon();
    mockPrisma.driverInfraction.create.mockResolvedValue({
      id: "inf-1",
      status: "PENDING_APPROVAL",
      multiplier: 1,
    });

    const result = await markInfraction({ ...baseInput, type: "RECLAMACAO_ASPERA" });
    expect(result.success).toBe(true);
    expect(result.infraction!.status).toBe("PENDING_APPROVAL");
    // The create call must NOT set status ACTIVE for the subjective type.
    const createCall = mockPrisma.driverInfraction.create.mock.calls[0][0];
    expect(createCall.data.status).toBe("PENDING_APPROVAL");
  });

  it("the other 4 types start ACTIVE immediately", async () => {
    const activeTypes = [
      "NAO_REVERTER_INSUCESSOS",
      "FALTAS_RECORRENTES",
      "ABANDONO_ROTA",
      "DESCUMPRIR_REGRAS_AMAZON",
    ];
    for (const type of activeTypes) {
      setupCommon();
      mockPrisma.driverInfraction.create.mockResolvedValue({
        id: "inf-1",
        status: "ACTIVE",
        multiplier: 1,
      });
      const result = await markInfraction({ ...baseInput, type });
      expect(result.success).toBe(true);
      expect(result.infraction!.status).toBe("ACTIVE");
      const createCall = mockPrisma.driverInfraction.create.mock.calls[0][0];
      expect(createCall.data.status).toBe("ACTIVE");
    }
  });

  it("applies the punishment to the week AFTER the marked week", async () => {
    setupCommon();
    mockPrisma.driverInfraction.create.mockResolvedValue({
      id: "inf-1",
      status: "ACTIVE",
      multiplier: 1,
    });
    await markInfraction({ ...baseInput, type: "NAO_REVERTER_INSUCESSOS" });
    const createCall = mockPrisma.driverInfraction.create.mock.calls[0][0];
    // Marked week ends 2026-08-23 → effective week starts 2026-08-24.
    expect(createCall.data.effectiveStartDate.toISOString().split("T")[0]).toBe(
      "2026-08-24"
    );
    expect(createCall.data.effectiveEndDate.toISOString().split("T")[0]).toBe(
      "2026-08-30"
    );
  });

  it("a supervisor cannot mark a driver from another transport company", async () => {
    setupCommon();
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: "driver-1",
      userId: "user-driver-1",
      user: { transportCompanyId: "tc-OTHER", active: true },
    });
    const result = await markInfraction({
      ...baseInput,
      type: "NAO_REVERTER_INSUCESSOS",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("não encontrado");
  });

  it("recidivism doubles the multiplier and notifies the supervisor", async () => {
    setupCommon();
    // An ACTIVE punishment exists → recidivism.
    mockPrisma.driverInfraction.count.mockResolvedValue(1);
    mockPrisma.driverInfraction.create.mockResolvedValue({
      id: "inf-1",
      status: "ACTIVE",
      multiplier: 2,
    });
    const result = await markInfraction({
      ...baseInput,
      type: "NAO_REVERTER_INSUCESSOS",
    });
    expect(result.success).toBe(true);
    expect(result.infraction!.multiplier).toBe(2);
    expect(result.infraction!.recidivism).toBe(true);
    const createCall = mockPrisma.driverInfraction.create.mock.calls[0][0];
    expect(createCall.data.multiplier).toBe(2);
    expect(createCall.data.supervisorNotifiedAt).not.toBeNull();
  });
});

describe("approveInfraction / rejectInfraction", () => {
  it("an account manager can approve a PENDING_APPROVAL infraction", async () => {
    mockAuth.mockResolvedValue(managerSession() as never);
    mockPrisma.driverInfraction.findUnique.mockResolvedValue({
      id: "inf-1",
      status: "PENDING_APPROVAL",
      type: "RECLAMACAO_ASPERA",
      driverProfileId: "driver-1",
    });
    mockPrisma.driverInfraction.update.mockResolvedValue({});
    const result = await approveInfraction("inf-1");
    expect(result.success).toBe(true);
    expect(mockPrisma.driverInfraction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  it("a supervisor cannot approve (requires account manager)", async () => {
    mockAuth.mockResolvedValue(supervisorSession() as never);
    await expect(approveInfraction("inf-1")).rejects.toThrow("Permissão insuficiente.");
  });

  it("an account manager can reject a PENDING_APPROVAL infraction", async () => {
    mockAuth.mockResolvedValue(managerSession() as never);
    mockPrisma.driverInfraction.findUnique.mockResolvedValue({
      id: "inf-1",
      status: "PENDING_APPROVAL",
      type: "RECLAMACAO_ASPERA",
      driverProfileId: "driver-1",
    });
    mockPrisma.driverInfraction.update.mockResolvedValue({});
    const result = await rejectInfraction("inf-1");
    expect(result.success).toBe(true);
    expect(mockPrisma.driverInfraction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
  });
});
