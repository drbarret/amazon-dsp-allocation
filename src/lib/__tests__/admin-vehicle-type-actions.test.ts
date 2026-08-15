import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for the supervisor vehicle-type edit server action.
//
// These call the REAL production server action (updateDriverVehicleType) with
// mocked auth() and prisma, proving the server-side authorization and
// validation gates:
//   - SUPERVISOR (or above) can edit a driver's vehicle category.
//   - A DRIVER cannot edit their own vehicle category (refused on the server).
//   - A value outside the VehicleType enum is refused on the server.
//   - The target must be a DRIVER with a profile.
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

const { updateDriverVehicleType } = await import(
  "@/app/(protected)/admin/users/actions"
);

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
      vehicleType: "CARGO_VAN",
    },
    ...overrides,
  };
}

describe("updateDriverVehicleType", () => {
  it("SUPERVISOR edits a driver's vehicle category successfully", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue(driverTarget());
    mockPrisma.driverProfile.update.mockResolvedValue({});

    const result = await updateDriverVehicleType("driver-id", "LARGE_VAN");
    expect(result).toEqual({ success: true });
    expect(mockPrisma.driverProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "profile-id" },
        data: expect.objectContaining({ vehicleType: "LARGE_VAN" }),
      })
    );
  });

  it("ACCOUNT_MANAGER edits a driver's vehicle category successfully", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("ACCOUNT_MANAGER"));
    mockPrisma.user.findUnique.mockResolvedValue(driverTarget());
    mockPrisma.driverProfile.update.mockResolvedValue({});
    const result = await updateDriverVehicleType("driver-id", "PASSEIO");
    expect(result).toEqual({ success: true });
  });

  it("a user cannot edit their OWN vehicle category (self-edit guard)", async () => {
    // A SUPERVISOR who is also a driver cannot edit their own category.
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverVehicleType("actor-id", "LARGE_VAN");
    expect(result).toEqual({
      success: false,
      error: "Você não pode editar a própria categoria de veículo.",
    });
    expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
  });

  it("DRIVER trying to edit ANOTHER driver's category is refused (permission)", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(
      updateDriverVehicleType("driver-id", "LARGE_VAN")
    ).rejects.toThrow("Permissão insuficiente.");
  });

  it("a value outside the VehicleType enum is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverVehicleType("driver-id", "MOTO");
    expect(result.success).toBe(false);
    expect(result.error).toContain("inválido");
    expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
  });

  it("an empty value is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const result = await updateDriverVehicleType("driver-id", "");
    expect(result.success).toBe(false);
    expect(result.error).toContain("inválido");
  });

  it("target that is not a DRIVER is refused", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "sup-id",
      role: "SUPERVISOR",
      driverProfile: null,
    });
    const result = await updateDriverVehicleType("sup-id", "LARGE_VAN");
    expect(result.success).toBe(false);
    expect(result.error).toContain("não é um motorista");
  });
});
