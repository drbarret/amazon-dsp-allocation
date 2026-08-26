import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ensurePreviousDispatchWeek } from "@/lib/performance-week-service";
import { prisma } from "@/lib/prisma";
import { getPreviousIsoWeek } from "@/lib/week-utils";
import { SKIP_INTEGRATION } from "@/lib/test-db-gate";

describe.skipIf(SKIP_INTEGRATION)("ensurePreviousDispatchWeek", () => {
  let companyId: string;

  beforeEach(async () => {
    const company = await prisma.transportCompany.create({
      data: { name: "Performance Test Transport", active: true },
    });
    companyId = company.id;
  });

  afterEach(async () => {
    await prisma.driverPerformanceSnapshot.deleteMany({
      where: { performanceImport: { transportCompanyId: companyId } },
    });
    await prisma.performanceImport.deleteMany({
      where: { transportCompanyId: companyId },
    });
    await prisma.dispatchWeek.deleteMany({
      where: { transportCompanyId: companyId },
    });
    await prisma.transportCompany.delete({ where: { id: companyId } });
  });

  it("creates the previous ISO week when it does not exist", async () => {
    const previousWeek = getPreviousIsoWeek();

    const result = await ensurePreviousDispatchWeek(undefined, [companyId]);

    expect(result.created).toBe(1);
    expect(result.existing).toBe(0);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0].year).toBe(previousWeek.year);
    expect(result.weeks[0].weekNumber).toBe(previousWeek.weekNumber);
    expect(result.weeks[0].status).toBe("PLANNING");
  });

  it("is idempotent and does not recreate an existing week", async () => {
    await ensurePreviousDispatchWeek(undefined, [companyId]);
    const result = await ensurePreviousDispatchWeek(undefined, [companyId]);

    expect(result.created).toBe(0);
    expect(result.existing).toBe(1);
    expect(result.weeks).toHaveLength(1);
  });

  it("does not close existing planning/open weeks", async () => {
    const currentWeek = getPreviousIsoWeek(new Date());
    const earlierWeek = getPreviousIsoWeek(
      new Date(currentWeek.startDate.getTime() - 7 * 24 * 60 * 60 * 1000),
    );

    await prisma.dispatchWeek.create({
      data: {
        transportCompanyId: companyId,
        weekKey: `WK-${String(earlierWeek.weekNumber).padStart(2, "0")}`,
        year: earlierWeek.year,
        weekNumber: earlierWeek.weekNumber,
        startDate: earlierWeek.startDate,
        endDate: earlierWeek.endDate,
        status: "PLANNING",
      },
    });

    const result = await ensurePreviousDispatchWeek(undefined, [companyId]);
    expect(result.created).toBe(1);

    const earlier = await prisma.dispatchWeek.findFirst({
      where: {
        transportCompanyId: companyId,
        year: earlierWeek.year,
        weekNumber: earlierWeek.weekNumber,
      },
    });
    expect(earlier?.status).toBe("PLANNING");
  });
});
