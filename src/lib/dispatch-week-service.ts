import { prisma } from "@/lib/prisma";
import {
  getNextIsoWeek,
  toWeekKey,
} from "@/lib/week-utils";
import type { DispatchWeek } from "@/generated/prisma";

export interface EnsureNextDispatchWeekResult {
  created: number;
  closed: number;
  weeks: DispatchWeek[];
}

/**
 * Idempotently ensures every active transport company has a dispatch week
 * for the ISO week after the given date. Any previous PLANNING or OPEN week
 * whose start date is before the next week's start date is automatically
 * closed.
 *
 * `transportCompanyIds` is optional and intended for tests; when omitted,
 * the function processes every active transport company.
 */
export async function ensureNextDispatchWeek(
  forDate?: Date,
  transportCompanyIds?: string[]
): Promise<EnsureNextDispatchWeekResult> {
  const nextWeek = getNextIsoWeek(forDate ?? new Date());
  const nextWeekStart = nextWeek.startDate;

  return prisma.$transaction(async (tx) => {
    const companies = await tx.transportCompany.findMany({
      where: {
        active: true,
        ...(transportCompanyIds?.length
          ? { id: { in: transportCompanyIds } }
          : {}),
      },
      select: { id: true },
    });

    let created = 0;
    let closed = 0;

    for (const company of companies) {
      const latestOpenWeek = await tx.dispatchWeek.findFirst({
        where: {
          transportCompanyId: company.id,
          status: { in: ["PLANNING", "OPEN"] },
        },
        orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
      });

      if (
        latestOpenWeek &&
        new Date(latestOpenWeek.startDate) < nextWeekStart
      ) {
        await tx.dispatchWeek.update({
          where: { id: latestOpenWeek.id },
          data: { status: "CLOSED" },
        });
        closed++;
      }

      const existing = await tx.dispatchWeek.findUnique({
        where: {
          transportCompanyId_year_weekNumber: {
            transportCompanyId: company.id,
            year: nextWeek.year,
            weekNumber: nextWeek.weekNumber,
          },
        },
      });

      if (!existing) {
        await tx.dispatchWeek.create({
          data: {
            transportCompanyId: company.id,
            weekKey: toWeekKey(nextWeek.weekNumber),
            year: nextWeek.year,
            weekNumber: nextWeek.weekNumber,
            startDate: nextWeekStart,
            endDate: nextWeek.endDate,
            status: "PLANNING",
          },
        });
        created++;
      }
    }

    const weeks = await tx.dispatchWeek.findMany({
      where: {
        year: nextWeek.year,
        weekNumber: nextWeek.weekNumber,
        transportCompanyId: { in: companies.map((c) => c.id) },
      },
      orderBy: [{ transportCompanyId: "asc" }],
    });

    return { created, closed, weeks };
  });
}
