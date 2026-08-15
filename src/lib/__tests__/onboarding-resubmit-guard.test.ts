import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Proves the onboarding re-submission hole is closed: once a driver has
// completed onboarding, calling completeOnboarding again is refused on the
// server, so a driver can no longer overwrite their own city preferences
// (or any other data) after the initial signup.
// ---------------------------------------------------------------------------

const mockPrisma = {
  driverProfile: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

const { completeOnboarding } = await import("@/lib/onboarding");

beforeEach(() => {
  vi.clearAllMocks();
});

const validInput = {
  cpf: "529.982.247-25",
  phone: "(11) 98765-4321",
  vehicleType: "CARGO_VAN" as const,
  restrictionCodes: [],
  transporterId: "T-1",
  consentGiven: true,
  cityPreferenceCities: ["Jundiaí"],
};

describe("completeOnboarding re-submission guard", () => {
  it("refuses when the driver has already completed onboarding", async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      onboardingCompleted: true,
    });

    const result = await completeOnboarding("user-1", validInput);

    expect(result.success).toBe(false);
    expect(result.error).toContain("já foi concluído");
    // No further DB writes happen.
    expect(mockPrisma.driverProfile.findUnique).toHaveBeenCalledTimes(1);
  });

  it("allows the initial submission when onboarding is not yet completed", async () => {
    // First findUnique (guard, by userId) → no existing profile.
    // Second findUnique (CPF uniqueness, by cpfBlindIndex) → no conflict.
    mockPrisma.driverProfile.findUnique.mockResolvedValue(null);
    mockPrisma.driverProfile.upsert.mockResolvedValue({});

    const result = await completeOnboarding("user-1", validInput);

    // The guard did NOT block the initial submission.
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockPrisma.driverProfile.upsert).toHaveBeenCalled();
  });
});
