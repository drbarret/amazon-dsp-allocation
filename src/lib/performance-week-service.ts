import { prisma } from "@/lib/prisma";
import { getPreviousIsoWeek, toWeekKey } from "@/lib/week-utils";
import type { DispatchWeek } from "@/generated/prisma";

export interface EnsurePreviousDispatchWeekResult {
  created: number;
  existing: number;
  weeks: DispatchWeek[];
}

/**
 * Idempotently ensures every active transport company has a dispatch week
 * for the ISO week before the given date. Unlike the availability automation,
 * this function does NOT close any weeks — it only creates the previous week
 * when it does not exist yet.
 *
 * `transportCompanyIds` is optional and intended for tests; when omitted,
 * the function processes every active transport company.
 */
export async function ensurePreviousDispatchWeek(
  forDate?: Date,
  transportCompanyIds?: string[],
): Promise<EnsurePreviousDispatchWeekResult> {
  const previousWeek = getPreviousIsoWeek(forDate ?? new Date());
  const previousWeekStart = previousWeek.startDate;

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
    let existing = 0;

    for (const company of companies) {
      const week = await tx.dispatchWeek.findUnique({
        where: {
          transportCompanyId_year_weekNumber: {
            transportCompanyId: company.id,
            year: previousWeek.year,
            weekNumber: previousWeek.weekNumber,
          },
        },
      });

      if (week) {
        existing++;
      } else {
        await tx.dispatchWeek.create({
          data: {
            transportCompanyId: company.id,
            weekKey: toWeekKey(previousWeek.weekNumber),
            year: previousWeek.year,
            weekNumber: previousWeek.weekNumber,
            startDate: previousWeekStart,
            endDate: previousWeek.endDate,
            status: "PLANNING",
          },
        });
        created++;
      }
    }

    const weeks = await tx.dispatchWeek.findMany({
      where: {
        year: previousWeek.year,
        weekNumber: previousWeek.weekNumber,
        transportCompanyId: { in: companies.map((c) => c.id) },
      },
      orderBy: [{ transportCompanyId: "asc" }],
    });

    return { created, existing, weeks };
  });
}
