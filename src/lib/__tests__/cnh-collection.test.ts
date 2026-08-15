import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for the manual CNH collection logic (src/lib/cnh-collection.ts).
//
// Proves:
//   - findExpiredCnhDrivers queries only ACTIVE DRIVERs whose CNH is already
//     expired (lt now), and returns the most recent collection per driver.
//   - buildCollectionEmail builds the "Cobrança de CNH atualizada" email.
//   - sendCnhCollection sends to each driver and records a history row per
//     send. Re-send is allowed: there is NO unique guard, so a driver charged
//     twice gets two history rows.
//   - No real email is sent: the sender is injected (mocked) in every test.
//   - Without RESEND_API_KEY, sendEmail degrades with a clear log and does
//     not throw.
// ---------------------------------------------------------------------------

const mockPrisma = {
  driverProfile: {
    findMany: vi.fn(),
  },
  cnhReminder: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

const {
  findExpiredCnhDrivers,
  buildCollectionEmail,
  sendCnhCollection,
} = await import("@/lib/cnh-collection");

beforeEach(() => {
  vi.clearAllMocks();
});

function driver(overrides: Record<string, unknown> = {}) {
  return {
    driverProfileId: "profile-1",
    userId: "user-1",
    name: "Driver One",
    email: "driver1@example.com",
    cnhExpiration: new Date("2026-07-01T00:00:00.000Z"),
    lastCollectedAt: null,
    ...overrides,
  };
}

describe("findExpiredCnhDrivers", () => {
  it("queries only expired (lt now) active DRIVERs and returns last collection", async () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    mockPrisma.driverProfile.findMany.mockResolvedValue([
      {
        id: "profile-1",
        cnhExpiration: new Date("2026-07-01T00:00:00.000Z"),
        user: { id: "user-1", name: "Driver One", email: "d1@example.com" },
        cnhReminders: [{ sentAt: new Date("2026-08-10T09:00:00.000Z") }],
      },
    ]);

    const result = await findExpiredCnhDrivers(now);

    const where = mockPrisma.driverProfile.findMany.mock.calls[0][0].where;
    // Only expired: cnhExpiration < now
    expect(where.cnhExpiration.lt).toBe(now);
    // Only active DRIVERs
    expect(where.user.role).toBe("DRIVER");
    expect(where.user.active).toBe(true);

    expect(result).toHaveLength(1);
    expect(result[0].driverProfileId).toBe("profile-1");
    expect(result[0].lastCollectedAt?.toISOString()).toBe(
      "2026-08-10T09:00:00.000Z"
    );
  });

  it("returns lastCollectedAt null when the driver was never charged", async () => {
    mockPrisma.driverProfile.findMany.mockResolvedValue([
      {
        id: "profile-1",
        cnhExpiration: new Date("2026-07-01T00:00:00.000Z"),
        user: { id: "user-1", name: "Driver One", email: "d1@example.com" },
        cnhReminders: [],
      },
    ]);
    const result = await findExpiredCnhDrivers(new Date("2026-08-15T12:00:00.000Z"));
    expect(result[0].lastCollectedAt).toBeNull();
  });
});

describe("buildCollectionEmail", () => {
  it("builds a 'Cobrança de CNH atualizada' email with the expiry date", () => {
    const { subject, text } = buildCollectionEmail({
      name: "Driver One",
      cnhExpiration: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(subject).toBe("Cobrança de CNH atualizada");
    expect(text).toContain("Driver One");
    expect(text).toContain("vencida");
  });
});

describe("sendCnhCollection", () => {
  it("sends to each driver and records a history row per send", async () => {
    const sendFn = vi.fn().mockResolvedValue({ sent: true, degraded: false });
    mockPrisma.cnhReminder.create.mockResolvedValue({});

    const outcomes = await sendCnhCollection([driver()], "actor-1", { sendFn });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("sent");
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0].to).toBe("driver1@example.com");
    expect(sendFn.mock.calls[0][0].subject).toBe("Cobrança de CNH atualizada");
    // History row recorded with the actor.
    expect(mockPrisma.cnhReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          driverProfileId: "profile-1",
          type: "CNH_COLLECTED",
          actorId: "actor-1",
        }),
      })
    );
  });

  it("RE-SEND is allowed: charging the same driver twice records two rows", async () => {
    const sendFn = vi.fn().mockResolvedValue({ sent: true, degraded: false });
    mockPrisma.cnhReminder.create.mockResolvedValue({});

    const d = driver();
    await sendCnhCollection([d], "actor-1", { sendFn });
    await sendCnhCollection([d], "actor-1", { sendFn });

    // Two sends, two history rows — no unique-constraint guard blocks re-send.
    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(mockPrisma.cnhReminder.create).toHaveBeenCalledTimes(2);
  });

  it("degrades (no send, no record) when the sender reports degraded", async () => {
    const sendFn = vi.fn().mockResolvedValue({ sent: false, degraded: true });
    const outcomes = await sendCnhCollection([driver()], "actor-1", { sendFn });

    expect(outcomes[0].status).toBe("degraded");
    expect(mockPrisma.cnhReminder.create).not.toHaveBeenCalled();
  });

  it("reports a failure with the reason when the sender fails", async () => {
    const sendFn = vi
      .fn()
      .mockResolvedValue({ sent: false, degraded: false, error: "SMTP 550" });
    const outcomes = await sendCnhCollection([driver()], "actor-1", { sendFn });

    expect(outcomes[0].status).toBe("failed");
    expect(outcomes[0].reason).toBe("SMTP 550");
    expect(mockPrisma.cnhReminder.create).not.toHaveBeenCalled();
  });
});

describe("sendEmail degradation (no RESEND_API_KEY)", () => {
  it("returns degraded without throwing and logs a clear warning", async () => {
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email");

    const result = await sendEmail({
      to: "driver@example.com",
      subject: "Cobrança de CNH atualizada",
      text: "corpo",
    });

    expect(result.sent).toBe(false);
    expect(result.degraded).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toContain("RESEND_API_KEY");

    warnSpy.mockRestore();
    if (prev === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prev;
  });
});
