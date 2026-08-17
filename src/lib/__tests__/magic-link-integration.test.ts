import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Magic link integration tests
//
// These tests verify the end-to-end flow of the Resend provider:
//   - AUTHORIZATION: ACTIVE AllowedEmail passes; BLOCKED/REVOKED/UNKNOWN are
//     refused (signInDecision + authorizeSignIn).
//   - ROLE PROMOTION: a new user created via magic link starts as DRIVER and is
//     promoted to the AllowedEmail role in jwtCallback.
//   - NO DEMOTION: existing users with higher roles keep their role.
//   - AMAZON STILL WORKS: the same authorization and promotion paths accept
//     the Amazon provider.
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

const { authorizeSignIn } = await import("@/lib/access-control");
const { signInDecision } = await import("@/lib/sign-in-decision");
const { jwtCallback } = await import("@/lib/jwt-callback");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Magic link authorization", () => {
  it("allows ACTIVE AllowedEmail via Resend", async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae1",
      email: "admin@instalog.com.br",
      role: "ADMIN",
      status: "ACTIVE",
    });

    const result = await signInDecision({
      email: "admin@instalog.com.br",
      provider: "resend",
      providerAccountId: "admin@instalog.com.br",
    });

    expect(result.allowed).toBe(true);
  });

  it("refuses BLOCKED AllowedEmail via Resend", async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae2",
      email: "blocked@instalog.com.br",
      role: "ADMIN",
      status: "BLOCKED",
    });

    const result = await signInDecision({
      email: "blocked@instalog.com.br",
      provider: "resend",
      providerAccountId: "blocked@instalog.com.br",
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("refuses REVOKED AllowedEmail via Resend", async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae3",
      email: "revoked@instalog.com.br",
      role: "ADMIN",
      status: "REVOKED",
    });

    const result = await signInDecision({
      email: "revoked@instalog.com.br",
      provider: "resend",
      providerAccountId: "revoked@instalog.com.br",
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("refuses unknown email via Resend", async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaAllowedEmail.findUnique.mockResolvedValue(null);

    const result = await signInDecision({
      email: "unknown@instalog.com.br",
      provider: "resend",
      providerAccountId: "unknown@instalog.com.br",
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("authorizes via access-control for ACTIVE AllowedEmail", async () => {
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae4",
      email: "manager@instalog.com.br",
      role: "ACCOUNT_MANAGER",
      status: "ACTIVE",
    });

    const result = await authorizeSignIn("manager@instalog.com.br");

    expect(result.allowed).toBe(true);
  });

  it("blocks via access-control for REVOKED AllowedEmail", async () => {
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae5",
      email: "fired@instalog.com.br",
      role: "ADMIN",
      status: "REVOKED",
    });

    const result = await authorizeSignIn("fired@instalog.com.br");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });
});

describe("Magic link role promotion", () => {
  it("promotes DRIVER to ACCOUNT_MANAGER on first Resend sign-in", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u1",
      email: "promote@instalog.com.br",
      role: "DRIVER",
      amazonSub: null,
      active: true,
    });
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae6",
      email: "promote@instalog.com.br",
      role: "ACCOUNT_MANAGER",
      status: "ACTIVE",
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await jwtCallback({
      token: { email: "promote@instalog.com.br" },
      account: { provider: "resend" },
    });

    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { email: "promote@instalog.com.br" },
      data: { role: "ACCOUNT_MANAGER" },
    });
    expect(result.role).toBe("ACCOUNT_MANAGER");
    expect(result.amazonSub).toBeNull();
  });

  it("promotes DRIVER to ADMIN on first Resend sign-in", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u2",
      email: "admin-promote@instalog.com.br",
      role: "DRIVER",
      amazonSub: null,
      active: true,
    });
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae7",
      email: "admin-promote@instalog.com.br",
      role: "ADMIN",
      status: "ACTIVE",
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await jwtCallback({
      token: { email: "admin-promote@instalog.com.br" },
      account: { provider: "resend" },
    });

    expect(result.role).toBe("ADMIN");
  });

  it("does NOT demote an existing ADMIN", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u3",
      email: "still-admin@instalog.com.br",
      role: "ADMIN",
      amazonSub: "amzn-admin",
      active: true,
    });

    const result = await jwtCallback({
      token: { email: "still-admin@instalog.com.br" },
      account: { provider: "resend" },
    });

    expect(mockPrismaAllowedEmail.findUnique).not.toHaveBeenCalled();
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
    expect(result.role).toBe("ADMIN");
  });
});

describe("Amazon login keeps working", () => {
  it("allows ACTIVE driver via Amazon and updates amazonSub", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u4",
      email: "driver@example.com",
      active: true,
      role: "DRIVER",
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await signInDecision({
      email: "driver@example.com",
      provider: "amazon",
      providerAccountId: "amzn-driver-123",
    });

    expect(result.allowed).toBe(true);
    expect(mockPrismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amazonSub: "amzn-driver-123" }),
      })
    );
  });

  it("promotes DRIVER to SUPERVISOR on first Amazon sign-in", async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      id: "u5",
      email: "super@example.com",
      role: "DRIVER",
      amazonSub: "amzn-super",
      active: true,
    });
    mockPrismaAllowedEmail.findUnique.mockResolvedValue({
      id: "ae8",
      email: "super@example.com",
      role: "SUPERVISOR",
      status: "ACTIVE",
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await jwtCallback({
      token: { email: "super@example.com" },
      account: { provider: "amazon" },
    });

    expect(result.role).toBe("SUPERVISOR");
  });
});
