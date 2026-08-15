import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for the supervisor CNH collection server action (collectCnh).
//
// These call the REAL production server action with mocked auth(), prisma and
// the email sender, proving the server-side gates:
//   - Permission: only SUPERVISOR (or above) may collect.
//   - The recipient list from the client is NEVER trusted: each selected user
//     is revalidated on the server (role DRIVER, active, CNH already expired).
//     A driver with a VALID CNH or an INACTIVE driver in the selection is
//     refused and never emailed.
//   - Re-send is allowed (two calls both succeed).
//   - No real email is sent: the sender is mocked, and only validated drivers
//     reach it.
//   - The collection is audited with the actor and counts (no PII).
// ---------------------------------------------------------------------------

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

const mockPrisma = {
  user: {
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

// Mock the email sender so NO real email is ever sent during tests.
const { mockSendCnhCollection } = vi.hoisted(() => ({
  mockSendCnhCollection: vi.fn(),
}));

vi.mock("@/lib/cnh-collection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cnh-collection")>();
  return {
    ...actual,
    sendCnhCollection: mockSendCnhCollection,
  };
});

const { collectCnh } = await import("@/app/(protected)/cnh/actions");

beforeEach(() => {
  vi.clearAllMocks();
});

function sessionWithRole(role: string) {
  return { user: { id: "actor-id", role, active: true } };
}

function expiredDriver(overrides: Record<string, unknown> = {}) {
  return {
    id: "driver-1",
    name: "Driver One",
    role: "DRIVER",
    active: true,
    email: "driver1@example.com",
    driverProfile: {
      id: "profile-1",
      cnhExpiration: new Date("2026-07-01T00:00:00.000Z"), // expired
    },
    ...overrides,
  };
}

describe("collectCnh", () => {
  it("DRIVER (below supervisor) is refused on the server", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(collectCnh(["driver-1"])).rejects.toThrow("Permissão insuficiente.");
    expect(mockSendCnhCollection).not.toHaveBeenCalled();
  });

  it("SUPERVISOR collects from an expired active driver (sent)", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findMany.mockResolvedValue([expiredDriver()]);
    mockSendCnhCollection.mockResolvedValue([
      { driverProfileId: "profile-1", userId: "driver-1", status: "sent" },
    ]);

    const result = await collectCnh(["driver-1"]);

    expect(result.success).toBe(true);
    expect(result.sent).toBe(1);
    expect(result.rejected).toHaveLength(0);
    // Only the validated driver reaches the sender.
    expect(mockSendCnhCollection).toHaveBeenCalledTimes(1);
    expect(mockSendCnhCollection.mock.calls[0][0]).toHaveLength(1);
    expect(mockSendCnhCollection.mock.calls[0][0][0].userId).toBe("driver-1");
    expect(mockSendCnhCollection.mock.calls[0][1]).toBe("actor-id");
  });

  it("a driver with a VALID (not expired) CNH in the selection is refused and NOT emailed", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    mockPrisma.user.findMany.mockResolvedValue([
      expiredDriver({ id: "driver-valid", name: "Valid Driver", driverProfile: { id: "p-valid", cnhExpiration: future } }),
    ]);
    mockSendCnhCollection.mockResolvedValue([]);

    const result = await collectCnh(["driver-valid"]);

    expect(result.success).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain("não está vencida");
    // The sender is never called for a refused driver.
    expect(mockSendCnhCollection).toHaveBeenCalledWith([], "actor-id");
  });

  it("an INACTIVE driver in the selection is refused and NOT emailed", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findMany.mockResolvedValue([
      expiredDriver({ id: "driver-inactive", name: "Inactive Driver", active: false }),
    ]);
    mockSendCnhCollection.mockResolvedValue([]);

    const result = await collectCnh(["driver-inactive"]);

    expect(result.success).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain("inativo");
    expect(mockSendCnhCollection).toHaveBeenCalledWith([], "actor-id");
  });

  it("a non-DRIVER in the selection is refused and NOT emailed", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "sup-1", name: "A Supervisor", role: "SUPERVISOR", active: true, email: "s@x.com", driverProfile: null },
    ]);
    mockSendCnhCollection.mockResolvedValue([]);

    const result = await collectCnh(["sup-1"]);

    expect(result.sent).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain("motorista");
    expect(mockSendCnhCollection).toHaveBeenCalledWith([], "actor-id");
  });

  it("RE-SEND is allowed: collecting the same driver twice both succeed", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findMany.mockResolvedValue([expiredDriver()]);
    mockSendCnhCollection.mockResolvedValue([
      { driverProfileId: "profile-1", userId: "driver-1", status: "sent" },
    ]);

    const first = await collectCnh(["driver-1"]);
    const second = await collectCnh(["driver-1"]);

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(1);
    expect(mockSendCnhCollection).toHaveBeenCalledTimes(2);
  });

  it("duplicate ids in the selection are deduplicated", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findMany.mockResolvedValue([expiredDriver()]);
    mockSendCnhCollection.mockResolvedValue([
      { driverProfileId: "profile-1", userId: "driver-1", status: "sent" },
    ]);

    const result = await collectCnh(["driver-1", "driver-1", "driver-1"]);

    expect(result.sent).toBe(1);
    // Only one validated driver reaches the sender.
    expect(mockSendCnhCollection.mock.calls[0][0]).toHaveLength(1);
  });

  it("audits the collection with actor and counts (no PII)", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findMany.mockResolvedValue([expiredDriver()]);
    mockSendCnhCollection.mockResolvedValue([
      { driverProfileId: "profile-1", userId: "driver-1", status: "sent" },
    ]);

    await collectCnh(["driver-1"]);

    const { writeAuditLog } = await import("@/lib/audit");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "CNH_COLLECTED",
        actorId: "actor-id",
        metadata: expect.objectContaining({ sent: 1, requested: 1 }),
      })
    );
  });
});
