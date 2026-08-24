import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import { ensureNextDispatchWeek } from "@/lib/dispatch-week-service";

describe.skipIf(SKIP_INTEGRATION)("ensureNextDispatchWeek", () => {
  const runId = Date.now();
  let activeCompanyAId = "";
  let activeCompanyBId = "";
  let inactiveCompanyId = "";
  let dbReady = false;

  beforeAll(async () => {
    await requireDatabase();
    dbReady = true;

    const [activeA, activeB, inactive] = await Promise.all([
      prisma.transportCompany.create({
        data: { name: `Auto Week Active A ${runId}`, active: true },
      }),
      prisma.transportCompany.create({
        data: { name: `Auto Week Active B ${runId}`, active: true },
      }),
      prisma.transportCompany.create({
        data: { name: `Auto Week Inactive ${runId}`, active: false },
      }),
    ]);

    activeCompanyAId = activeA.id;
    activeCompanyBId = activeB.id;
    inactiveCompanyId = inactive.id;
  });

  afterEach(async () => {
    if (!dbReady) return;
    await prisma.dispatchWeek.deleteMany({
      where: {
        transportCompanyId: {
          in: [activeCompanyAId, activeCompanyBId, inactiveCompanyId],
        },
      },
    });
  });

  afterAll(async () => {
    if (!dbReady) return;

    await prisma.dispatchWeek.deleteMany({
      where: {
        transportCompanyId: {
          in: [activeCompanyAId, activeCompanyBId, inactiveCompanyId],
        },
      },
    });
    await prisma.transportCompany.deleteMany({
      where: { id: { in: [activeCompanyAId, activeCompanyBId, inactiveCompanyId] } },
    });
  });

  it("creates the next dispatch week for every active company", async () => {
    const anchor = new Date("2026-08-26T12:00:00Z");
    const result = await ensureNextDispatchWeek(anchor, [
      activeCompanyAId,
      activeCompanyBId,
    ]);

    expect(result.created).toBe(2);
    expect(result.closed).toBe(0);
    expect(result.weeks).toHaveLength(2);
    expect(result.weeks.every((w) => w.year === 2026 && w.weekNumber === 36)).toBe(true);

    const byCompany = new Map(result.weeks.map((w) => [w.transportCompanyId, w]));
    expect(byCompany.has(activeCompanyAId)).toBe(true);
    expect(byCompany.has(activeCompanyBId)).toBe(true);
  });

  it("is idempotent: running again does not duplicate weeks", async () => {
    const anchor = new Date("2026-08-26T12:00:00Z");
    const first = await ensureNextDispatchWeek(anchor, [activeCompanyAId]);
    const second = await ensureNextDispatchWeek(anchor, [activeCompanyAId]);

    expect(second.created).toBe(0);
    expect(second.closed).toBe(0);
    expect(second.weeks.map((w) => w.id).sort()).toEqual(
      first.weeks.map((w) => w.id).sort()
    );
  });

  it("closes the previous open week and creates the next one", async () => {
    // Create a previous week for company A.
    const previous = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId: activeCompanyAId,
        weekKey: "WK-35",
        year: 2026,
        weekNumber: 35,
        startDate: new Date("2026-08-24"),
        endDate: new Date("2026-08-30"),
        status: "PLANNING",
      },
    });

    const anchor = new Date("2026-08-30T03:05:00Z");
    const result = await ensureNextDispatchWeek(anchor, [activeCompanyAId]);

    expect(result.created).toBe(1);
    expect(result.closed).toBe(1);

    const updated = await prisma.dispatchWeek.findUnique({
      where: { id: previous.id },
    });
    expect(updated?.status).toBe("CLOSED");
  });

  it("does not create dispatch weeks for inactive companies", async () => {
    const anchor = new Date("2026-08-26T12:00:00Z");
    const result = await ensureNextDispatchWeek(anchor, [inactiveCompanyId]);

    expect(result.created).toBe(0);
    expect(result.closed).toBe(0);
    expect(result.weeks).toHaveLength(0);
  });

  it("only closes weeks that start before the next ISO week", async () => {
    // Create an OPEN week that starts on the same day as the next ISO week.
    const sameStartWeek = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId: activeCompanyBId,
        weekKey: "WK-36",
        year: 2026,
        weekNumber: 36,
        startDate: new Date("2026-08-31"),
        endDate: new Date("2026-09-06"),
        status: "OPEN",
      },
    });

    const anchor = new Date("2026-08-26T12:00:00Z");
    const result = await ensureNextDispatchWeek(anchor, [activeCompanyBId]);

    expect(result.created).toBe(0);
    expect(result.closed).toBe(0);

    const unchanged = await prisma.dispatchWeek.findUnique({
      where: { id: sameStartWeek.id },
    });
    expect(unchanged?.status).toBe("OPEN");
  });
});
