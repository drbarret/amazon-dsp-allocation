import { describe, it, expect, vi, beforeEach } from "vitest";
import { roleIsAtLeast } from "@/lib/authz";

// ---------------------------------------------------------------------------
// Pure function tests — no mocking needed
// ---------------------------------------------------------------------------

describe("roleIsAtLeast", () => {
  // Hierarchy: ADMIN(4) > ACCOUNT_MANAGER(3) > SUPERVISOR(2) > DRIVER(1)

  it("ADMIN >= ADMIN", () => expect(roleIsAtLeast("ADMIN", "ADMIN")).toBe(true));
  it("ADMIN >= ACCOUNT_MANAGER", () => expect(roleIsAtLeast("ADMIN", "ACCOUNT_MANAGER")).toBe(true));
  it("ADMIN >= SUPERVISOR", () => expect(roleIsAtLeast("ADMIN", "SUPERVISOR")).toBe(true));
  it("ADMIN >= DRIVER", () => expect(roleIsAtLeast("ADMIN", "DRIVER")).toBe(true));

  it("ACCOUNT_MANAGER >= ACCOUNT_MANAGER", () => expect(roleIsAtLeast("ACCOUNT_MANAGER", "ACCOUNT_MANAGER")).toBe(true));
  it("ACCOUNT_MANAGER >= SUPERVISOR", () => expect(roleIsAtLeast("ACCOUNT_MANAGER", "SUPERVISOR")).toBe(true));
  it("ACCOUNT_MANAGER >= DRIVER", () => expect(roleIsAtLeast("ACCOUNT_MANAGER", "DRIVER")).toBe(true));
  it("ACCOUNT_MANAGER >= ADMIN", () => expect(roleIsAtLeast("ACCOUNT_MANAGER", "ADMIN")).toBe(false));

  it("SUPERVISOR >= SUPERVISOR", () => expect(roleIsAtLeast("SUPERVISOR", "SUPERVISOR")).toBe(true));
  it("SUPERVISOR >= DRIVER", () => expect(roleIsAtLeast("SUPERVISOR", "DRIVER")).toBe(true));
  it("SUPERVISOR >= ACCOUNT_MANAGER", () => expect(roleIsAtLeast("SUPERVISOR", "ACCOUNT_MANAGER")).toBe(false));
  it("SUPERVISOR >= ADMIN", () => expect(roleIsAtLeast("SUPERVISOR", "ADMIN")).toBe(false));

  it("DRIVER >= DRIVER", () => expect(roleIsAtLeast("DRIVER", "DRIVER")).toBe(true));
  it("DRIVER >= SUPERVISOR", () => expect(roleIsAtLeast("DRIVER", "SUPERVISOR")).toBe(false));
  it("DRIVER >= ACCOUNT_MANAGER", () => expect(roleIsAtLeast("DRIVER", "ACCOUNT_MANAGER")).toBe(false));
  it("DRIVER >= ADMIN", () => expect(roleIsAtLeast("DRIVER", "ADMIN")).toBe(false));

  it("undefined role returns false", () => {
    expect(roleIsAtLeast(undefined, "DRIVER")).toBe(false);
    expect(roleIsAtLeast(undefined, "ADMIN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireAuth / requireRole — mock auth() and redirect
// ---------------------------------------------------------------------------

const { mockAuth, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRedirect: vi.fn().mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

const { requireAuth, requireRole } = await import("@/lib/authz");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAuth", () => {
  it("redirects to /login when no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when session has no user.id", async () => {
    mockAuth.mockResolvedValue({ user: {} });
    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login?error=deactivated when active is false", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", active: false } });
    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login?error=deactivated");
  });

  it("returns session for active user", async () => {
    const session = { user: { id: "u1", active: true, role: "DRIVER" } };
    mockAuth.mockResolvedValue(session);
    const result = await requireAuth();
    expect(result).toBe(session);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  it("redirects to /forbidden when role is below threshold", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", active: true, role: "DRIVER" } });
    await expect(requireRole("SUPERVISOR")).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/forbidden");
  });

  it("redirects to /forbidden when role is undefined", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", active: true } });
    await expect(requireRole("DRIVER")).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/forbidden");
  });

  it("returns session when role meets threshold", async () => {
    const session = { user: { id: "u1", active: true, role: "SUPERVISOR" } };
    mockAuth.mockResolvedValue(session);
    const result = await requireRole("SUPERVISOR");
    expect(result).toBe(session);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("returns session when role exceeds threshold", async () => {
    const session = { user: { id: "u1", active: true, role: "ADMIN" } };
    mockAuth.mockResolvedValue(session);
    const result = await requireRole("SUPERVISOR");
    expect(result).toBe(session);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("also enforces deactivated check (via requireAuth)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", active: false, role: "ADMIN" } });
    await expect(requireRole("DRIVER")).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login?error=deactivated");
  });
});
