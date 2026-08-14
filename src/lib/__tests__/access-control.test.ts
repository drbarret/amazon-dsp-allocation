import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// authorizeSignIn / isPreRegistered — mock prisma
// ---------------------------------------------------------------------------

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    allowedEmail: {
      findUnique: mockFindUnique,
    },
  },
}));

const { authorizeSignIn, isPreRegistered } = await import("@/lib/access-control");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isPreRegistered", () => {
  it("returns record for ACTIVE pre-registered email", async () => {
    const record = { id: "1", email: "user@gmail.com", role: "DRIVER", status: "ACTIVE" };
    mockFindUnique.mockResolvedValue(record);
    const result = await isPreRegistered("user@gmail.com");
    expect(result).toBe(record);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: "user@gmail.com" },
    });
  });

  it("returns null for REVOKED pre-registered email", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1", email: "user@gmail.com", role: "DRIVER", status: "REVOKED",
    });
    const result = await isPreRegistered("user@gmail.com");
    expect(result).toBeNull();
  });

  it("returns null for non-existent email", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await isPreRegistered("unknown@gmail.com");
    expect(result).toBeNull();
  });

  it("normalizes email to lowercase", async () => {
    mockFindUnique.mockResolvedValue(null);
    await isPreRegistered("User@Gmail.Com");
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: "user@gmail.com" },
    });
  });
});

describe("authorizeSignIn", () => {
  // -----------------------------------------------------------------------
  // Pre-registered ACTIVE → allowed
  // -----------------------------------------------------------------------
  it("allows pre-registered ACTIVE email (owner)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1", email: "drbarret@gmail.com", role: "ADMIN", status: "ACTIVE",
    });
    const result = await authorizeSignIn("drbarret@gmail.com");
    expect(result.allowed).toBe(true);
  });

  it("allows pre-registered ACTIVE corporate email (staff)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "2", email: "gustavo.alves@instalog.com.br", role: "SUPERVISOR", status: "ACTIVE",
    });
    const result = await authorizeSignIn("gustavo.alves@instalog.com.br");
    expect(result.allowed).toBe(true);
  });

  it("allows pre-registered ACTIVE non-corporate email", async () => {
    mockFindUnique.mockResolvedValue({
      id: "3", email: "partner@other-company.com", role: "DRIVER", status: "ACTIVE",
    });
    const result = await authorizeSignIn("partner@other-company.com");
    expect(result.allowed).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Corporate domain but absent from the list → refused
  // -----------------------------------------------------------------------
  it("refuses corporate-domain email NOT on the pre-registered list", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await authorizeSignIn("unknown@instalog.com.br");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  // -----------------------------------------------------------------------
  // REVOKED → refused
  // -----------------------------------------------------------------------
  it("refuses REVOKED pre-registered email", async () => {
    mockFindUnique.mockResolvedValue({
      id: "4", email: "revoked@instalog.com.br", role: "DRIVER", status: "REVOKED",
    });
    const result = await authorizeSignIn("revoked@instalog.com.br");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  // -----------------------------------------------------------------------
  // External (unknown domain, not pre-registered) → refused
  // -----------------------------------------------------------------------
  it("refuses external email not pre-registered", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await authorizeSignIn("stranger@gmail.com");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  // -----------------------------------------------------------------------
  // Owner → allowed (explicit test)
  // -----------------------------------------------------------------------
  it("allows owner (drbarret@gmail.com) when ACTIVE in AllowedEmail", async () => {
    mockFindUnique.mockResolvedValue({
      id: "owner", email: "drbarret@gmail.com", role: "ADMIN", status: "ACTIVE",
    });
    const result = await authorizeSignIn("drbarret@gmail.com");
    expect(result.allowed).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Owner row missing → refused (loud failure)
  // -----------------------------------------------------------------------
  it("refuses owner if AllowedEmail row is missing (loud failure mode)", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await authorizeSignIn("drbarret@gmail.com");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });
});