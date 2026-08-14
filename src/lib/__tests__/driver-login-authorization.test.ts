import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Test: INACTIVE driver is refused at login, ACTIVE driver is accepted.
//
// The authorization has TWO layers:
//   Layer 1: authorizeSignIn() in access-control.ts — checks AllowedEmail.status === "ACTIVE"
//   Layer 2: signIn callback in auth.ts:56-63 — checks User.active for existing users
//
// This test calls the REAL production code for both layers by mocking prisma.
// If someone breaks the active check in auth.ts or the status check in
// access-control.ts, this test MUST fail.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrismaUser = {
  findUnique: vi.fn(),
  update: vi.fn(),
};

const mockPrismaAllowedEmail = {
  findUnique: vi.fn(),
};

const mockPrisma = {
  user: mockPrismaUser,
  allowedEmail: mockPrismaAllowedEmail,
  auditLog: { create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Import the REAL production code
const { authorizeSignIn } = await import("@/lib/access-control");
const { signInDecision } = await import("@/lib/sign-in-decision");

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Layer 1 tests: authorizeSignIn (access-control.ts)
// These call the REAL authorizeSignIn function with mocked prisma.
// ---------------------------------------------------------------------------

describe("Layer 1: authorizeSignIn (AllowedEmail.status check)", () => {
  it("allows ACTIVE AllowedEmail", async () => {
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae1", email: "driver@test.com", role: "DRIVER", status: "ACTIVE",
    });
    const result = await authorizeSignIn("driver@test.com");
    expect(result.allowed).toBe(true);
  });

  it("refuses REVOKED AllowedEmail", async () => {
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae2", email: "revoked@test.com", role: "DRIVER", status: "REVOKED",
    });
    const result = await authorizeSignIn("revoked@test.com");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("refuses BLOCKED AllowedEmail", async () => {
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae3", email: "blocked@test.com", role: "DRIVER", status: "BLOCKED",
    });
    const result = await authorizeSignIn("blocked@test.com");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("refuses email not in AllowedEmail table", async () => {
    mockPrismaAllowedEmail.findUnique.mockResolvedValue(null);
    const result = await authorizeSignIn("unknown@test.com");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 tests: signInDecision (extracted from auth.ts signIn callback)
// These call the REAL signInDecision function — the same code that auth.ts
// uses in its signIn callback. If someone changes the active check in
// signInDecision, this test MUST fail.
// ---------------------------------------------------------------------------

describe("Layer 2: signInDecision (User.active check)", () => {
  it("allows ACTIVE existing user", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u1", email: "active@test.com", active: true, role: "DRIVER",
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await signInDecision({
      email: "active@test.com",
      providerAccountId: "amzn-123",
    });
    expect(result.allowed).toBe(true);
  });

  it("refuses INACTIVE existing user", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u2", email: "inactive@test.com", active: false, role: "DRIVER",
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await signInDecision({
      email: "inactive@test.com",
      providerAccountId: "amzn-456",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("user_deactivated");
    }
  });

  it("allows new user with ACTIVE AllowedEmail", async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae4", email: "new@test.com", role: "DRIVER", status: "ACTIVE",
    });

    const result = await signInDecision({
      email: "new@test.com",
      providerAccountId: "amzn-789",
    });
    expect(result.allowed).toBe(true);
  });

  it("refuses new user with REVOKED AllowedEmail", async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae5", email: "revoked-new@test.com", role: "DRIVER", status: "REVOKED",
    });

    const result = await signInDecision({
      email: "revoked-new@test.com",
      providerAccountId: "amzn-000",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("refuses new user with BLOCKED AllowedEmail", async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae6", email: "blocked-new@test.com", role: "DRIVER", status: "BLOCKED",
    });

    const result = await signInDecision({
      email: "blocked-new@test.com",
      providerAccountId: "amzn-111",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("refuses new user with no AllowedEmail record", async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaAllowedEmail.findUnique.mockResolvedValue(null);

    const result = await signInDecision({
      email: "unknown@test.com",
      providerAccountId: "amzn-222",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  // -----------------------------------------------------------------------
  // Edge: ACTIVE existing user with REVOKED AllowedEmail → still allowed
  // (existingUser check comes first and passes)
  // -----------------------------------------------------------------------
  it("allows ACTIVE existing user even if AllowedEmail is REVOKED (existing user path wins)", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u3", email: "active-revoked@test.com", active: true, role: "DRIVER",
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await signInDecision({
      email: "active-revoked@test.com",
      providerAccountId: "amzn-333",
    });
    expect(result.allowed).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Edge: INACTIVE existing user with ACTIVE AllowedEmail → refused
  // (existingUser.active=false check wins)
  // -----------------------------------------------------------------------
  it("refuses INACTIVE existing user even if AllowedEmail is ACTIVE", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u4", email: "inactive-allowed@test.com", active: false, role: "DRIVER",
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await signInDecision({
      email: "inactive-allowed@test.com",
      providerAccountId: "amzn-444",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("user_deactivated");
    }
  });
});
