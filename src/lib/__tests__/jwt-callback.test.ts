import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// 1b: Prove the jwt callback's role freshness window and fail-closed behavior.
//
// Three behaviours tested:
//   1. Inside the 60s freshness window → no DB read, token unchanged
//   2. Past the window → role/active re-read from DB and updated on the token
//   3. User row missing → fails closed (active = false)
//
// We import from @/lib/jwt-callback directly to avoid the next-auth import
// chain (which requires next/server, unavailable in Vitest).
// ---------------------------------------------------------------------------

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  allowedEmail: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

const { jwtCallback, ROLE_FRESHNESS_MS } = await import("@/lib/jwt-callback");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("1b: jwt callback role freshness", () => {
  // -----------------------------------------------------------------------
  // Behaviour 1: Inside freshness window → no DB read, token unchanged
  // -----------------------------------------------------------------------
  it("does NOT re-read from DB when roleLastFetched is within the freshness window", async () => {
    const now = Date.now();
    const token = {
      email: "test@instalog.com.br",
      role: "ADMIN",
      active: true,
      roleLastFetched: now - 30_000, // 30s ago — inside 60s window
    };

    const result = await jwtCallback({ token });

    // The DB should NOT have been queried
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();

    // Token should be unchanged
    expect(result.role).toBe("ADMIN");
    expect(result.active).toBe(true);
    expect(result.roleLastFetched).toBe(token.roleLastFetched);
  });

  // -----------------------------------------------------------------------
  // Behaviour 2: Past the window → role/active re-read from DB
  // -----------------------------------------------------------------------
  it("re-reads role and active from DB when freshness window has expired", async () => {
    const now = Date.now();
    const token = {
      email: "test@instalog.com.br",
      role: "DRIVER",
      active: true,
      roleLastFetched: now - 90_000, // 90s ago — past 60s window
    };

    // DB now says the user is ADMIN and deactivated
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "ADMIN",
      active: false,
    });

    const result = await jwtCallback({ token });

    // DB should have been queried
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "test@instalog.com.br" },
      select: { role: true, active: true },
    });

    // Token should reflect the DB values
    expect(result.role).toBe("ADMIN");
    expect(result.active).toBe(false);
    // roleLastFetched should be updated to approximately now
    expect(result.roleLastFetched).toBeGreaterThanOrEqual(now);
  });

  // -----------------------------------------------------------------------
  // Behaviour 3: User row missing → fail closed (active = false)
  // -----------------------------------------------------------------------
  it("sets active=false when user row is missing (fail-closed)", async () => {
    const now = Date.now();
    const token = {
      email: "deleted@instalog.com.br",
      role: "DRIVER",
      active: true,
      roleLastFetched: now - 90_000, // past window
    };

    // DB returns null — user was deleted
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await jwtCallback({ token });

    // DB should have been queried
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "deleted@instalog.com.br" },
      select: { role: true, active: true },
    });

    // Token should be fail-closed
    expect(result.active).toBe(false);
    // Role should remain unchanged (not overwritten)
    expect(result.role).toBe("DRIVER");
  });

  // -----------------------------------------------------------------------
  // Edge case: no email on token → no freshness check
  // -----------------------------------------------------------------------
  it("skips freshness check when token has no email", async () => {
    const token = {
      role: "DRIVER",
      active: true,
      roleLastFetched: 0, // ancient — would trigger if email were present
    };

    const result = await jwtCallback({ token });

    // DB should NOT have been queried (no email to look up)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();

    // Token should be unchanged
    expect(result.role).toBe("DRIVER");
    expect(result.active).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Edge case: exactly at the boundary (60,000ms) → still inside window
  // -----------------------------------------------------------------------
  it("does NOT re-read at exactly ROLE_FRESHNESS_MS boundary", async () => {
    const now = Date.now();
    const token = {
      email: "test@instalog.com.br",
      role: "DRIVER",
      active: true,
      roleLastFetched: now - ROLE_FRESHNESS_MS, // exactly 60s ago
    };

    const result = await jwtCallback({ token });

    // The condition is `now - lastFetched > ROLE_FRESHNESS_MS` (strict >)
    // So exactly at the boundary should NOT trigger a re-read
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(result.role).toBe("DRIVER");
  });

  // -----------------------------------------------------------------------
  // Edge case: 1ms past the boundary → triggers re-read
  // -----------------------------------------------------------------------
  it("re-reads at ROLE_FRESHNESS_MS + 1ms", async () => {
    const now = Date.now();
    const token = {
      email: "test@instalog.com.br",
      role: "DRIVER",
      active: true,
      roleLastFetched: now - ROLE_FRESHNESS_MS - 1, // 1ms past window
    };

    mockPrisma.user.findUnique.mockResolvedValue({
      role: "SUPERVISOR",
      active: true,
    });

    const result = await jwtCallback({ token });

    expect(mockPrisma.user.findUnique).toHaveBeenCalled();
    expect(result.role).toBe("SUPERVISOR");
  });
});
