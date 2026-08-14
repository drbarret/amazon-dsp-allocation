import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Prove that setDriverGnvMarking enforces SUPERVISOR+ authorization:
// - SUPERVISOR, ACCOUNT_MANAGER, ADMIN can call it
// - DRIVER and unauthenticated are refused at the server-action level
// - The audit row is written with actor + before/after
// ---------------------------------------------------------------------------

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

// Mock prisma
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
  vehicleRestriction: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock writeAuditLog
const mockWriteAuditLog = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAuditLog: mockWriteAuditLog,
}));

// Mock revalidatePath
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { setDriverGnvMarking } = await import("@/lib/driver-actions");

beforeEach(() => {
  vi.clearAllMocks();
});

function sessionWithRole(role: string) {
  return { user: { id: "actor-id", role, active: true } };
}

// Helper: a driver target with no existing GNV restriction
const driverTargetNoGnv = {
  id: "driver-1",
  role: "DRIVER",
  driverProfile: {
    id: "dp-1",
    vehicleRestrictions: [],
  },
};

// Helper: a driver target with existing GNV restriction
const driverTargetWithGnv = {
  id: "driver-2",
  role: "DRIVER",
  driverProfile: {
    id: "dp-2",
    vehicleRestrictions: [{ id: "vr-1", code: "GNV" }],
  },
};

describe("setDriverGnvMarking — authorization gate", () => {
  // -----------------------------------------------------------------------
  // Unauthenticated — should throw "Não autenticado."
  // -----------------------------------------------------------------------
  describe("Unauthenticated", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(null);
    });

    it("throws 'Não autenticado.' when setting GNV", async () => {
      await expect(setDriverGnvMarking("driver-1", true)).rejects.toThrow(
        "Não autenticado."
      );
    });

    it("throws 'Não autenticado.' when clearing GNV", async () => {
      await expect(setDriverGnvMarking("driver-1", false)).rejects.toThrow(
        "Não autenticado."
      );
    });
  });

  // -----------------------------------------------------------------------
  // DRIVER — should throw "Permissão insuficiente."
  // -----------------------------------------------------------------------
  describe("DRIVER session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    });

    it("throws 'Permissão insuficiente.' when setting GNV", async () => {
      await expect(setDriverGnvMarking("driver-1", true)).rejects.toThrow(
        "Permissão insuficiente."
      );
    });

    it("throws 'Permissão insuficiente.' when clearing GNV", async () => {
      await expect(setDriverGnvMarking("driver-1", false)).rejects.toThrow(
        "Permissão insuficiente."
      );
    });
  });

  // -----------------------------------------------------------------------
  // SUPERVISOR — should be ALLOWED
  // -----------------------------------------------------------------------
  describe("SUPERVISOR session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    });

    it("can set GNV on a driver without it", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetNoGnv);
      mockPrisma.vehicleRestriction.create.mockResolvedValue({});
      mockPrisma.vehicleRestriction.findMany.mockResolvedValue([{ code: "GNV" }]);

      const result = await setDriverGnvMarking("driver-1", true);
      expect(result).toEqual({ success: true });

      // Verify audit was written with correct before/after
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "VEHICLE_RESTRICTION_UPDATED",
          actorId: "actor-id",
          targetUserId: "driver-1",
          oldValue: { restrictions: [] },
          newValue: { restrictions: ["GNV"] },
        })
      );
    });

    it("can clear GNV on a driver that has it", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetWithGnv);
      mockPrisma.vehicleRestriction.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.vehicleRestriction.findMany.mockResolvedValue([]);

      const result = await setDriverGnvMarking("driver-2", false);
      expect(result).toEqual({ success: true });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "VEHICLE_RESTRICTION_UPDATED",
          actorId: "actor-id",
          targetUserId: "driver-2",
          oldValue: { restrictions: ["GNV"] },
          newValue: { restrictions: [] },
        })
      );
    });

    it("returns error when setting GNV on driver that already has it", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetWithGnv);

      const result = await setDriverGnvMarking("driver-2", true);
      expect(result).toEqual({
        success: false,
        error: "GNV já está marcado para este motorista.",
      });
    });

    it("returns error when clearing GNV on driver without it", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetNoGnv);

      const result = await setDriverGnvMarking("driver-1", false);
      expect(result).toEqual({
        success: false,
        error: "GNV não está marcado para este motorista.",
      });
    });

    it("returns error when target user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await setDriverGnvMarking("nonexistent", true);
      expect(result).toEqual({
        success: false,
        error: "Usuário não encontrado.",
      });
    });

    it("returns error when target has no driver profile", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "no-profile",
        role: "DRIVER",
        driverProfile: null,
      });

      const result = await setDriverGnvMarking("no-profile", true);
      expect(result).toEqual({
        success: false,
        error: "Motorista não possui perfil de direção cadastrado.",
      });
    });
  });

  // -----------------------------------------------------------------------
  // ACCOUNT_MANAGER — should be ALLOWED
  // -----------------------------------------------------------------------
  describe("ACCOUNT_MANAGER session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("ACCOUNT_MANAGER"));
    });

    it("can set GNV", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetNoGnv);
      mockPrisma.vehicleRestriction.create.mockResolvedValue({});
      mockPrisma.vehicleRestriction.findMany.mockResolvedValue([{ code: "GNV" }]);

      const result = await setDriverGnvMarking("driver-1", true);
      expect(result).toEqual({ success: true });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "VEHICLE_RESTRICTION_UPDATED" })
      );
    });

    it("can clear GNV", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetWithGnv);
      mockPrisma.vehicleRestriction.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.vehicleRestriction.findMany.mockResolvedValue([]);

      const result = await setDriverGnvMarking("driver-2", false);
      expect(result).toEqual({ success: true });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "VEHICLE_RESTRICTION_UPDATED" })
      );
    });
  });

  // -----------------------------------------------------------------------
  // ADMIN — should be ALLOWED
  // -----------------------------------------------------------------------
  describe("ADMIN session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("ADMIN"));
    });

    it("can set GNV", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetNoGnv);
      mockPrisma.vehicleRestriction.create.mockResolvedValue({});
      mockPrisma.vehicleRestriction.findMany.mockResolvedValue([{ code: "GNV" }]);

      const result = await setDriverGnvMarking("driver-1", true);
      expect(result).toEqual({ success: true });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "VEHICLE_RESTRICTION_UPDATED" })
      );
    });

    it("can clear GNV", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetWithGnv);
      mockPrisma.vehicleRestriction.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.vehicleRestriction.findMany.mockResolvedValue([]);

      const result = await setDriverGnvMarking("driver-2", false);
      expect(result).toEqual({ success: true });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "VEHICLE_RESTRICTION_UPDATED" })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Prove NATURAL_GAS is never written — only GNV is canonical
  // -----------------------------------------------------------------------
  describe("canonical code enforcement", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    });

    it("setDriverGnvMarking creates only GNV, never NATURAL_GAS", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(driverTargetNoGnv);
      mockPrisma.vehicleRestriction.create.mockResolvedValue({});
      mockPrisma.vehicleRestriction.findMany.mockResolvedValue([{ code: "GNV" }]);

      await setDriverGnvMarking("driver-1", true);

      // The create call must use GNV, not NATURAL_GAS
      const createCalls = mockPrisma.vehicleRestriction.create.mock.calls;
      expect(createCalls.length).toBe(1);
      expect(createCalls[0][0].data.code).toBe("GNV");
    });

    it("setDriverGnvMarking deletes both codes for cleanup but only creates GNV", async () => {
      // Driver has NATURAL_GAS (legacy) — supervisor clears it
      const driverWithLegacyGas = {
        id: "driver-3",
        role: "DRIVER",
        driverProfile: {
          id: "dp-3",
          vehicleRestrictions: [{ id: "vr-2", code: "NATURAL_GAS" }],
        },
      };
      mockPrisma.user.findUnique.mockResolvedValue(driverWithLegacyGas);
      mockPrisma.vehicleRestriction.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.vehicleRestriction.findMany.mockResolvedValue([]);

      const result = await setDriverGnvMarking("driver-3", false);
      expect(result).toEqual({ success: true });

      // deleteMany should cover both codes for cleanup
      const deleteCalls = mockPrisma.vehicleRestriction.deleteMany.mock.calls;
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0][0].where.code.in).toContain("GNV");
      expect(deleteCalls[0][0].where.code.in).toContain("NATURAL_GAS");
    });
  });
});
