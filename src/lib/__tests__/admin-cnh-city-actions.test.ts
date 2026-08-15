import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for the supervisor CNH + city-preference edit server actions.
//
// These call the REAL production server actions (updateDriverCnh,
// updateDriverCityPreferences) with mocked auth() and prisma, proving the
// server-side authorization and validation gates:
//   - SUPERVISOR (or above) can edit a driver's CNH and cities.
//   - A DRIVER cannot edit their own CNH or cities (refused on the server).
//   - Invalid CNH dates are refused on the server.
//   - City validation (1-3, no dup, only the 8 allowed) is enforced on the
//     server.
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
    update: vi.fn(),
  },
  regionCityPreference: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
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
  updateDriverCnh,
  updateDriverCityPreferences,
} = await import("@/app/(protected)/admin/users/actions");

beforeEach(() => {
  vi.clearAllMocks();
});

function sessionWithRole(role: string) {
  return { user: { id: "actor-id", role, active: true } };
}

function driverTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: "driver-id",
    role: "DRIVER",
    driverProfile: {
      id: "profile-id",
      cnhExpiration: new Date("2026-01-01T00:00:00.000Z"),
      regionPreferences: [
        { city: "Jundiaí", priority: 1 },
        { city: "Louveira", priority: 2 },
      ],
    },
    ...overrides,
  };
}

describe("updateDriverCnh", () => {
  it("SUPERVISOR edits a driver's CNH successfully", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue(driverTarget());
    mockPrisma.driverProfile.update.mockResolvedValue({});

    const result = await updateDriverCnh("driver-id", "2027-05-10");
    expect(result).toEqual({ success: true });
    expect(mockPrisma.driverProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "profile-id" },
        data: expect.objectContaining({ cnhExpiration: expect.any(Date) }),
      })
    );
  });

  it("ACCOUNT_MANAGER edits a driver's CNH successfully", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("ACCOUNT_MANAGER"));
    mockPrisma.user.findUnique.mockResolvedValue(driverTarget());
    mockPrisma.driverProfile.update.mockResolvedValue({});
    const result = await updateDriverCnh("driver-id", "2027-05-10");
    expect(result).toEqual({ success: true });
  });

  it("a user cannot edit their OWN CNH (self-edit guard)", async () => {
    // A SUPERVISOR who is also a driver cannot edit their own CNH.
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverCnh("actor-id", "2027-05-10");
    expect(result).toEqual({
      success: false,
      error: "Você não pode editar a própria CNH.",
    });
    expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
  });

  it("DRIVER trying to edit ANOTHER driver's CNH is refused (permission)", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(updateDriverCnh("driver-id", "2027-05-10")).rejects.toThrow(
      "Permissão insuficiente."
    );
  });

  it("invalid date (garbage) is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverCnh("driver-id", "not-a-date");
    expect(result.success).toBe(false);
    expect(result.error).toContain("inválida");
    expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
  });

  it("date before 1990 is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverCnh("driver-id", "1985-01-01");
    expect(result.success).toBe(false);
    expect(result.error).toContain("1990");
  });

  it("date more than 10 years in the future is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 11);
    const result = await updateDriverCnh("driver-id", farFuture.toISOString().slice(0, 10));
    expect(result.success).toBe(false);
    expect(result.error).toContain("10 anos");
  });

  it("target that is not a DRIVER is refused", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "sup-id",
      role: "SUPERVISOR",
      driverProfile: null,
    });
    const result = await updateDriverCnh("sup-id", "2027-05-10");
    expect(result.success).toBe(false);
    expect(result.error).toContain("não é um motorista");
  });
});

describe("updateDriverCityPreferences", () => {
  it("SUPERVISOR sets 1 city", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue(driverTarget());
    mockPrisma.$transaction.mockResolvedValue([]);
    const result = await updateDriverCityPreferences("driver-id", ["Jundiaí"]);
    expect(result).toEqual({ success: true });
  });

  it("SUPERVISOR sets 2 cities", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue(driverTarget());
    mockPrisma.$transaction.mockResolvedValue([]);
    const result = await updateDriverCityPreferences("driver-id", [
      "Jundiaí",
      "Louveira",
    ]);
    expect(result).toEqual({ success: true });
  });

  it("SUPERVISOR sets 3 cities", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue(driverTarget());
    mockPrisma.$transaction.mockResolvedValue([]);
    const result = await updateDriverCityPreferences("driver-id", [
      "Jundiaí",
      "Louveira",
      "Vinhedo",
    ]);
    expect(result).toEqual({ success: true });
  });

  it("0 cities is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverCityPreferences("driver-id", []);
    expect(result.success).toBe(false);
    expect(result.error).toContain("1 e 3");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("4 cities is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverCityPreferences("driver-id", [
      "Jundiaí",
      "Louveira",
      "Vinhedo",
      "Itupeva",
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("1 e 3");
  });

  it("city outside the 8 allowed is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverCityPreferences("driver-id", ["São Paulo"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cidade inválida");
  });

  it("duplicate city is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverCityPreferences("driver-id", [
      "Jundiaí",
      "Jundiaí",
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("mesma cidade");
  });

  it("a user cannot edit their OWN cities (self-edit guard)", async () => {
    // A SUPERVISOR who is also a driver cannot edit their own cities.
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverCityPreferences("actor-id", ["Jundiaí"]);
    expect(result).toEqual({
      success: false,
      error: "Você não pode editar as próprias cidades de preferência.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("DRIVER trying to edit ANOTHER driver's cities is refused (permission)", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(
      updateDriverCityPreferences("driver-id", ["Jundiaí"])
    ).rejects.toThrow("Permissão insuficiente.");
  });
});
