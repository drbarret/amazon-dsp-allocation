import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// 1b: Prove the jwt callback's role freshness window and fail-closed behavior.
//
// Three behaviours tested:
//   1. Inside the 15s freshness window → no DB read, token unchanged
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
      roleLastFetched: now - 7_000, // 7s ago — inside 15s window
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
      roleLastFetched: now - 20_000, // 20s ago — past 15s window
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
      roleLastFetched: now - 20_000, // past window
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
  // Edge case: exactly at the boundary (15,000ms) → still inside window
  // -----------------------------------------------------------------------
  it("does NOT re-read at exactly ROLE_FRESHNESS_MS boundary", async () => {
    const now = Date.now();
    const token = {
      email: "test@instalog.com.br",
      role: "DRIVER",
      active: true,
      roleLastFetched: now - ROLE_FRESHNESS_MS, // exactly 15s ago
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

// ---------------------------------------------------------------------------
// Finding 2: First-sign-in role promotion path (account?.provider === "amazon")
//
// Tests the branch at jwt-callback.ts:16-43 that reads the user from DB
// and promotes DRIVER → SUPERVISOR / ACCOUNT_MANAGER / ADMIN based on
// AllowedEmail. This is the code that fixes the "corporate-domain users
// always land as DRIVER" bug.
// ---------------------------------------------------------------------------

describe("First-sign-in role promotion (account.provider === 'amazon')", () => {
  const baseToken = {
    email: "test@instalog.com.br",
    name: "Test User",
  };

  const amazonAccount = { provider: "amazon" };

  // -----------------------------------------------------------------------
  // Promotion: DRIVER → SUPERVISOR via AllowedEmail
  // -----------------------------------------------------------------------
  it("promotes DRIVER to SUPERVISOR when AllowedEmail has SUPERVISOR role", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "DRIVER",
      amazonSub: "amzn-123",
      active: true,
    });
    mockPrisma.allowedEmail.findUnique.mockResolvedValue({
      role: "SUPERVISOR",
    });
    mockPrisma.user.update.mockResolvedValue({});

    const result = await jwtCallback({
      token: { ...baseToken },
      account: amazonAccount,
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { email: "test@instalog.com.br" },
      data: { role: "SUPERVISOR" },
    });
    expect(result.role).toBe("SUPERVISOR");
    expect(result.active).toBe(true);
    expect(result.amazonSub).toBe("amzn-123");
    expect(result.roleLastFetched).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Promotion: DRIVER → ACCOUNT_MANAGER via AllowedEmail
  // -----------------------------------------------------------------------
  it("promotes DRIVER to ACCOUNT_MANAGER when AllowedEmail has ACCOUNT_MANAGER role", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "DRIVER",
      amazonSub: "amzn-456",
      active: true,
    });
    mockPrisma.allowedEmail.findUnique.mockResolvedValue({
      role: "ACCOUNT_MANAGER",
    });
    mockPrisma.user.update.mockResolvedValue({});

    const result = await jwtCallback({
      token: { ...baseToken },
      account: amazonAccount,
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { email: "test@instalog.com.br" },
      data: { role: "ACCOUNT_MANAGER" },
    });
    expect(result.role).toBe("ACCOUNT_MANAGER");
  });

  // -----------------------------------------------------------------------
  // Promotion: DRIVER → ADMIN via AllowedEmail
  // -----------------------------------------------------------------------
  it("promotes DRIVER to ADMIN when AllowedEmail has ADMIN role", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "DRIVER",
      amazonSub: "amzn-789",
      active: true,
    });
    mockPrisma.allowedEmail.findUnique.mockResolvedValue({
      role: "ADMIN",
    });
    mockPrisma.user.update.mockResolvedValue({});

    const result = await jwtCallback({
      token: { ...baseToken },
      account: amazonAccount,
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { email: "test@instalog.com.br" },
      data: { role: "ADMIN" },
    });
    expect(result.role).toBe("ADMIN");
  });

  // -----------------------------------------------------------------------
  // No promotion: DRIVER stays DRIVER when no AllowedEmail exists
  // -----------------------------------------------------------------------
  it("keeps DRIVER as DRIVER when no AllowedEmail row exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "DRIVER",
      amazonSub: "amzn-000",
      active: true,
    });
    mockPrisma.allowedEmail.findUnique.mockResolvedValue(null);

    const result = await jwtCallback({
      token: { ...baseToken },
      account: amazonAccount,
    });

    // Should NOT call user.update (no promotion)
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(result.role).toBe("DRIVER");
    expect(result.active).toBe(true);
  });

  // -----------------------------------------------------------------------
  // No promotion: DRIVER stays DRIVER when AllowedEmail has role DRIVER (no promotion needed)
  // -----------------------------------------------------------------------
  it("keeps DRIVER as DRIVER when AllowedEmail has role DRIVER (no promotion needed)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "DRIVER",
      amazonSub: "amzn-111",
      active: true,
    });
    mockPrisma.allowedEmail.findUnique.mockResolvedValue({
      role: "DRIVER",
    });

    const result = await jwtCallback({
      token: { ...baseToken },
      account: amazonAccount,
    });

    // AllowedEmail.role === "DRIVER" → no promotion
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(result.role).toBe("DRIVER");
  });

  // -----------------------------------------------------------------------
  // REVOKED AllowedEmail: code does not check status, only role
  // -----------------------------------------------------------------------
  it("promotes DRIVER even when AllowedEmail is REVOKED (status not checked)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "DRIVER",
      amazonSub: "amzn-revoked",
      active: true,
    });
    // AllowedEmail exists with SUPERVISOR role — select only includes { role }
    // so status is not available to the callback
    mockPrisma.allowedEmail.findUnique.mockResolvedValue({
      role: "SUPERVISOR",
    });
    mockPrisma.user.update.mockResolvedValue({});

    const result = await jwtCallback({
      token: { ...baseToken },
      account: amazonAccount,
    });

    // Current behavior: promotes based on role alone, ignoring status
    expect(result.role).toBe("SUPERVISOR");
  });

  // -----------------------------------------------------------------------
  // No promotion: non-DRIVER user keeps their existing role
  // -----------------------------------------------------------------------
  it("keeps SUPERVISOR as SUPERVISOR (no AllowedEmail lookup for non-DRIVER)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "SUPERVISOR",
      amazonSub: "amzn-222",
      active: true,
    });

    const result = await jwtCallback({
      token: { ...baseToken },
      account: amazonAccount,
    });

    // Should NOT query AllowedEmail (only for DRIVER)
    expect(mockPrisma.allowedEmail.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(result.role).toBe("SUPERVISOR");
  });

  // -----------------------------------------------------------------------
  // Missing user row: no dbUser → freshness check runs, fail-closed
  // -----------------------------------------------------------------------
  it("sets active=false when user row is missing on first sign-in (freshness check fail-closed)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await jwtCallback({
      token: { ...baseToken },
      account: amazonAccount,
    });

    // First-sign-in branch: no dbUser → skips setting role/active/amazonSub
    // Freshness check: roleLastFetched=0, now-0 > 15s → queries DB, gets null → active=false
    // Note: fail-closed branch does NOT update roleLastFetched (stays undefined)
    expect(result.role).toBeUndefined();
    expect(result.active).toBe(false);
    expect(result.amazonSub).toBeUndefined();
    expect(result.roleLastFetched).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Non-amazon provider: skips the first-sign-in branch, but freshness check still runs
  // -----------------------------------------------------------------------
  it("skips first-sign-in branch for non-amazon providers (freshness check still runs)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "DRIVER",
      active: true,
    });

    const result = await jwtCallback({
      token: { ...baseToken },
      account: { provider: "google" },
    });

    // First-sign-in branch skipped (provider !== "amazon")
    expect(mockPrisma.allowedEmail.findUnique).not.toHaveBeenCalled();
    // Freshness check runs independently: roleLastFetched=0, now-0 > 15s → queries DB
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "test@instalog.com.br" },
      select: { role: true, active: true },
    });
    expect(result.role).toBe("DRIVER");
    expect(result.active).toBe(true);
  });
});
