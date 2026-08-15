/**
 * Gate for integration tests that require a real Postgres database.
 *
 * Policy:
 *   - By default the database is MANDATORY: if it is unreachable the test
 *     FAILS HIGH (throws in beforeAll) instead of silently passing.
 *   - The only legitimate way to skip is to set SKIP_INTEGRATION_TESTS=1
 *     (a deliberate, visible opt-out used by CI, which has no database).
 *     When set, the suite is marked as "skipped" in the vitest output —
 *     never as "passed".
 *
 * Usage:
 *   describe.skipIf(SKIP_INTEGRATION)("...", () => {
 *     beforeAll(async () => {
 *       await requireDatabase(); // throws if unreachable and not skipped
 *       // ... setup
 *     });
 *   });
 */
import { prisma } from "@/lib/prisma";

/** True when the operator deliberately opted out of integration tests. */
export const SKIP_INTEGRATION =
  (process.env.SKIP_INTEGRATION_TESTS ?? "").trim() === "1";

/**
 * Assert the database is reachable. Throws a descriptive error otherwise.
 * Only called when SKIP_INTEGRATION is not set, so a failure here is a real
 * error — never a silent pass.
 */
export async function requireDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const detail =
      err instanceof Error ? ` (${err.message})` : "";
    throw new Error(
      `Integration test requires a reachable database, but the connection failed${detail}. ` +
        `Provide a valid DATABASE_URL, or set SKIP_INTEGRATION_TESTS=1 to skip these tests explicitly.`
    );
  }
}
