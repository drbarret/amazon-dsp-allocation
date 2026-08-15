import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for the CNH expiry reminder logic (src/lib/cnh-reminder.ts).
//
// Proves:
//   - findDriversExpiringWithin queries the correct 30-day window.
//   - sendCnhReminders is idempotent: an already-reminded driver is skipped.
//   - sendCnhReminders records a reminder after a successful send.
//   - Without RESEND_API_KEY, sendEmail degrades with a clear log and does
//     not throw (no crash).
// ---------------------------------------------------------------------------

const mockPrisma = {
  driverProfile: {
    findMany: vi.fn(),
  },
  cnhReminder: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

const { findDriversExpiringWithin, sendCnhReminders, REMINDER_WINDOW_DAYS } =
  await import("@/lib/cnh-reminder");

beforeEach(() => {
  vi.clearAllMocks();
});

function driver(overrides: Record<string, unknown> = {}) {
  return {
    driverProfileId: "profile-1",
    userId: "user-1",
    name: "Driver One",
    email: "driver1@example.com",
    cnhExpiration: new Date("2026-09-15T00:00:00.000Z"),
    ...overrides,
  };
}

describe("findDriversExpiringWithin", () => {
  it("queries the 30-day window (gte=today, lt=today+30)", async () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    mockPrisma.driverProfile.findMany.mockResolvedValue([
      {
        id: "profile-1",
        cnhExpiration: new Date("2026-09-10T00:00:00.000Z"),
        user: { id: "user-1", name: "Driver One", email: "d1@example.com" },
      },
    ]);

    const result = await findDriversExpiringWithin(REMINDER_WINDOW_DAYS, now);

    const where = mockPrisma.driverProfile.findMany.mock.calls[0][0].where;
    const start = where.cnhExpiration.gte;
    const end = where.cnhExpiration.lt;
    // start = today at 00:00
    expect(start.getUTCFullYear()).toBe(2026);
    expect(start.getUTCMonth()).toBe(7); // Aug
    expect(start.getUTCDate()).toBe(15);
    // end = start + 30 days
    expect(end.getUTCDate()).toBe(14); // Sep 14
    expect(end.getUTCMonth()).toBe(8); // Sep

    expect(result).toHaveLength(1);
    expect(result[0].driverProfileId).toBe("profile-1");
  });
});

describe("sendCnhReminders", () => {
  it("sends to a due driver and records the reminder (idempotency proof)", async () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    const dueDriver = driver();
    mockPrisma.driverProfile.findMany.mockResolvedValue([
      {
        id: dueDriver.driverProfileId,
        cnhExpiration: dueDriver.cnhExpiration,
        user: { id: dueDriver.userId, name: dueDriver.name, email: dueDriver.email },
      },
    ]);
    // Not yet reminded
    mockPrisma.cnhReminder.findUnique.mockResolvedValue(null);
    mockPrisma.cnhReminder.create.mockResolvedValue({});

    const sendFn = vi.fn().mockResolvedValue({ sent: true, degraded: false });

    const result = await sendCnhReminders({ now, sendFn });

    expect(result.sent).toHaveLength(1);
    expect(result.sent[0].driverProfileId).toBe("profile-1");
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0].to).toBe("driver1@example.com");
    // The reminder is recorded for idempotency.
    expect(mockPrisma.cnhReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          driverProfileId: "profile-1",
          type: "CNH_EXPIRY_30D",
        }),
      })
    );
  });

  it("does NOT re-send to a driver already reminded for that expiry (idempotency)", async () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    const dueDriver = driver();
    mockPrisma.driverProfile.findMany.mockResolvedValue([
      {
        id: dueDriver.driverProfileId,
        cnhExpiration: dueDriver.cnhExpiration,
        user: { id: dueDriver.userId, name: dueDriver.name, email: dueDriver.email },
      },
    ]);
    // Already reminded for this exact expiry date.
    mockPrisma.cnhReminder.findUnique.mockResolvedValue({ id: "reminder-1" });

    const sendFn = vi.fn().mockResolvedValue({ sent: true, degraded: false });

    const result = await sendCnhReminders({ now, sendFn });

    expect(result.sent).toHaveLength(0);
    expect(result.alreadyReminded).toHaveLength(1);
    expect(sendFn).not.toHaveBeenCalled();
    expect(mockPrisma.cnhReminder.create).not.toHaveBeenCalled();
  });

  it("dry-run does not send or record", async () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    const dueDriver = driver();
    mockPrisma.driverProfile.findMany.mockResolvedValue([
      {
        id: dueDriver.driverProfileId,
        cnhExpiration: dueDriver.cnhExpiration,
        user: { id: dueDriver.userId, name: dueDriver.name, email: dueDriver.email },
      },
    ]);
    mockPrisma.cnhReminder.findUnique.mockResolvedValue(null);

    const sendFn = vi.fn().mockResolvedValue({ sent: true, degraded: false });

    const result = await sendCnhReminders({ now, dryRun: true, sendFn });

    expect(result.sent).toHaveLength(1);
    expect(sendFn).not.toHaveBeenCalled();
    expect(mockPrisma.cnhReminder.create).not.toHaveBeenCalled();
  });

  it("degrades (no send, no record) when the sender reports degraded", async () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    const dueDriver = driver();
    mockPrisma.driverProfile.findMany.mockResolvedValue([
      {
        id: dueDriver.driverProfileId,
        cnhExpiration: dueDriver.cnhExpiration,
        user: { id: dueDriver.userId, name: dueDriver.name, email: dueDriver.email },
      },
    ]);
    mockPrisma.cnhReminder.findUnique.mockResolvedValue(null);

    // Simulate no RESEND_API_KEY → degraded.
    const sendFn = vi.fn().mockResolvedValue({ sent: false, degraded: true });

    const result = await sendCnhReminders({ now, sendFn });

    expect(result.sent).toHaveLength(0);
    expect(result.degraded).toHaveLength(1);
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
      subject: "Sua CNH vai vencer em breve",
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
