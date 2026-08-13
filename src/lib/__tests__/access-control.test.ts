import { describe, it, expect, vi, beforeEach } from "vitest";
import { isCorporateDomain } from "@/lib/access-control";

// ---------------------------------------------------------------------------
// isCorporateDomain — pure function (reads ALLOWED_DOMAINS env var)
// ---------------------------------------------------------------------------

describe("isCorporateDomain", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_DOMAINS;
  });

  it("allows instalog.com.br (default domain)", () => {
    expect(isCorporateDomain("user@instalog.com.br")).toBe(true);
  });

  it("allows INSTALOG.COM.BR (case insensitive)", () => {
    expect(isCorporateDomain("user@INSTALOG.COM.BR")).toBe(true);
  });

  it("allows subaddress with +", () => {
    expect(isCorporateDomain("user+tag@instalog.com.br")).toBe(true);
  });

  it("refuses unknown domain", () => {
    expect(isCorporateDomain("user@gmail.com")).toBe(false);
  });

  it("refuses email without domain", () => {
    expect(isCorporateDomain("no-at-sign")).toBe(false);
  });

  it("refuses empty string", () => {
    expect(isCorporateDomain("")).toBe(false);
  });

  it("respects ALLOWED_DOMAINS env var", () => {
    process.env.ALLOWED_DOMAINS = "instalog.com.br,amazon.com.br";
    expect(isCorporateDomain("user@instalog.com.br")).toBe(true);
    expect(isCorporateDomain("user@amazon.com.br")).toBe(true);
    expect(isCorporateDomain("user@gmail.com")).toBe(false);
  });

  it("handles whitespace in ALLOWED_DOMAINS", () => {
    process.env.ALLOWED_DOMAINS = " instalog.com.br , amazon.com.br ";
    expect(isCorporateDomain("user@instalog.com.br")).toBe(true);
    expect(isCorporateDomain("user@amazon.com.br")).toBe(true);
  });
});

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
  delete process.env.ALLOWED_DOMAINS;
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
  it("allows corporate domain email", async () => {
    const result = await authorizeSignIn("user@instalog.com.br");
    expect(result.allowed).toBe(true);
  });

  it("allows pre-registered email (non-corporate domain)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1", email: "drbarret@gmail.com", role: "ADMIN", status: "ACTIVE",
    });
    const result = await authorizeSignIn("drbarret@gmail.com");
    expect(result.allowed).toBe(true);
  });

  it("refuses unknown domain email that is not pre-registered", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await authorizeSignIn("stranger@gmail.com");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("refuses REVOKED pre-registered email (non-corporate domain)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1", email: "revoked@gmail.com", role: "DRIVER", status: "REVOKED",
    });
    const result = await authorizeSignIn("revoked@gmail.com");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
    }
  });

  it("corporate domain bypasses REVOKED status (owner cannot be locked out)", async () => {
    // Even if there's a REVOKED AllowedEmail row, corporate domain still wins
    mockFindUnique.mockResolvedValue({
      id: "1", email: "user@instalog.com.br", role: "DRIVER", status: "REVOKED",
    });
    const result = await authorizeSignIn("user@instalog.com.br");
    // Corporate domain check happens first, so it returns allowed before checking pre-registered
    expect(result.allowed).toBe(true);
  });
});
