import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// 4d: Prove that DRIVER and SUPERVISOR sessions are refused by the
//     requireAdminOrAccountManager() guard in admin server actions.
//
// This test mocks auth() to return sessions with different roles and
// verifies that each exported server action throws "Permissão insuficiente."
// for DRIVER and SUPERVISOR, and succeeds for ACCOUNT_MANAGER and ADMIN.
//
// We also mock prisma to avoid real DB calls — we only care about the
// authorization gate, not the actual DB operations.
// ---------------------------------------------------------------------------

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

// Mock prisma to avoid real DB calls
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  allowedEmail: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  driverProfile: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock writeAuditLog
vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

// Mock revalidatePath
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const {
  changeUserRole,
  deactivateUser,
  reactivateUser,
  inviteUser,
  revokeInvite,
} = await import("@/app/(protected)/admin/users/actions");

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper: create a session with a given role
function sessionWithRole(role: string) {
  return { user: { id: "test-user-id", role, active: true } };
}

describe("4d: Server action authorization gate", () => {
  // -----------------------------------------------------------------------
  // DRIVER — should be refused for ALL admin actions
  // -----------------------------------------------------------------------
  describe("DRIVER session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    });

    it("changeUserRole throws 'Permissão insuficiente.'", async () => {
      await expect(changeUserRole("target-id", "SUPERVISOR")).rejects.toThrow(
        "Permissão insuficiente."
      );
    });

    it("deactivateUser throws 'Permissão insuficiente.'", async () => {
      await expect(deactivateUser("target-id")).rejects.toThrow(
        "Permissão insuficiente."
      );
    });

    it("reactivateUser throws 'Permissão insuficiente.'", async () => {
      await expect(reactivateUser("target-id")).rejects.toThrow(
        "Permissão insuficiente."
      );
    });

    it("inviteUser throws 'Permissão insuficiente.'", async () => {
      await expect(
        inviteUser("test@instalog.com.br", "DRIVER")
      ).rejects.toThrow("Permissão insuficiente.");
    });

    it("revokeInvite throws 'Permissão insuficiente.'", async () => {
      await expect(revokeInvite("ae-id")).rejects.toThrow(
        "Permissão insuficiente."
      );
    });
  });

  // -----------------------------------------------------------------------
  // SUPERVISOR — should be refused for ALL admin actions
  // -----------------------------------------------------------------------
  describe("SUPERVISOR session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    });

    it("changeUserRole throws 'Permissão insuficiente.'", async () => {
      await expect(changeUserRole("target-id", "DRIVER")).rejects.toThrow(
        "Permissão insuficiente."
      );
    });

    it("deactivateUser throws 'Permissão insuficiente.'", async () => {
      await expect(deactivateUser("target-id")).rejects.toThrow(
        "Permissão insuficiente."
      );
    });

    it("reactivateUser throws 'Permissão insuficiente.'", async () => {
      await expect(reactivateUser("target-id")).rejects.toThrow(
        "Permissão insuficiente."
      );
    });

    it("inviteUser throws 'Permissão insuficiente.'", async () => {
      await expect(
        inviteUser("test@instalog.com.br", "DRIVER")
      ).rejects.toThrow("Permissão insuficiente.");
    });

    it("revokeInvite throws 'Permissão insuficiente.'", async () => {
      await expect(revokeInvite("ae-id")).rejects.toThrow(
        "Permissão insuficiente."
      );
    });
  });

  // -----------------------------------------------------------------------
  // ACCOUNT_MANAGER — should be ALLOWED (gate passes, then hits DB mock)
  // -----------------------------------------------------------------------
  describe("ACCOUNT_MANAGER session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("ACCOUNT_MANAGER"));
    });

    it("changeUserRole passes gate (hits DB, returns error for missing user)", async () => {
      // Gate passes, but DB call fails because target doesn't exist
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await changeUserRole("nonexistent", "DRIVER");
      expect(result).toEqual({
        success: false,
        error: "Usuário não encontrado.",
      });
      // The important thing: it did NOT throw "Permissão insuficiente."
    });

    it("deactivateUser passes gate", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await deactivateUser("nonexistent");
      expect(result).toEqual({
        success: false,
        error: "Usuário não encontrado.",
      });
    });

    it("reactivateUser passes gate", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await reactivateUser("nonexistent");
      expect(result).toEqual({
        success: false,
        error: "Usuário não encontrado.",
      });
    });

    it("inviteUser passes gate", async () => {
      mockPrisma.allowedEmail.findUnique.mockResolvedValue(null);
      mockPrisma.allowedEmail.create.mockResolvedValue({});
      const result = await inviteUser("new@instalog.com.br", "DRIVER");
      expect(result).toEqual({ success: true });
    });

    it("revokeInvite passes gate", async () => {
      mockPrisma.allowedEmail.findUnique.mockResolvedValue(null);
      const result = await revokeInvite("nonexistent");
      expect(result).toEqual({
        success: false,
        error: "Convite não encontrado.",
      });
    });
  });

  // -----------------------------------------------------------------------
  // ADMIN — should be ALLOWED
  // -----------------------------------------------------------------------
  describe("ADMIN session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(sessionWithRole("ADMIN"));
    });

    it("changeUserRole passes gate", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await changeUserRole("nonexistent", "DRIVER");
      expect(result).toEqual({
        success: false,
        error: "Usuário não encontrado.",
      });
    });

    it("deactivateUser passes gate", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await deactivateUser("nonexistent");
      expect(result).toEqual({
        success: false,
        error: "Usuário não encontrado.",
      });
    });

    it("inviteUser passes gate", async () => {
      mockPrisma.allowedEmail.findUnique.mockResolvedValue(null);
      mockPrisma.allowedEmail.create.mockResolvedValue({});
      const result = await inviteUser("new@instalog.com.br", "DRIVER");
      expect(result).toEqual({ success: true });
    });
  });

  // -----------------------------------------------------------------------
  // Unauthenticated — should throw "Não autenticado."
  // -----------------------------------------------------------------------
  describe("Unauthenticated", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(null);
    });

    it("changeUserRole throws 'Não autenticado.'", async () => {
      await expect(changeUserRole("target-id", "DRIVER")).rejects.toThrow(
        "Não autenticado."
      );
    });

    it("deactivateUser throws 'Não autenticado.'", async () => {
      await expect(deactivateUser("target-id")).rejects.toThrow(
        "Não autenticado."
      );
    });

    it("inviteUser throws 'Não autenticado.'", async () => {
      await expect(
        inviteUser("test@instalog.com.br", "DRIVER")
      ).rejects.toThrow("Não autenticado.");
    });
  });
});
