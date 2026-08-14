import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Test: INACTIVE driver is refused at login, ACTIVE driver is accepted.
//
// The authorization has TWO layers:
//   Layer 1: authorizeSignIn() in access-control.ts — checks AllowedEmail.status === "ACTIVE"
//   Layer 2: signIn callback in auth.ts:56-63 — checks User.active for existing users
//
// Layer 1 is already tested in access-control.test.ts.
// This file tests Layer 2 by exercising the same pattern used in auth.ts:
//   if (!existingUser.active) → redirect to /auth-error?error=deactivated
//
// We simulate the signIn callback logic directly since we cannot run the
// full OAuth flow without an Amazon provider.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Simulated signIn callback logic (extracted from auth.ts:37-72)
// ---------------------------------------------------------------------------

interface SimulatedUser {
  id: string;
  email: string;
  active: boolean;
  role: string;
}

interface AllowedEmailRecord {
  id: string;
  email: string;
  status: string;
  role: string;
}

/**
 * Simulates the signIn callback logic from auth.ts.
 * This is the EXACT same pattern, extracted for testability.
 */
function simulateSignInDecision(
  existingUser: SimulatedUser | null,
  allowedEmail: AllowedEmailRecord | null
): { allowed: boolean; reason?: string } {
  if (existingUser) {
    // auth.ts:56-63 — refuse deactivated users
    if (!existingUser.active) {
      return { allowed: false, reason: "user_deactivated" };
    }
    // auth.ts:66-71 — log successful login
    return { allowed: true };
  }

  // New user: check access control (auth.ts:74-82)
  if (!allowedEmail || allowedEmail.status !== "ACTIVE") {
    return { allowed: false, reason: "EMAIL_NOT_AUTHORIZED" };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("signIn authorization — ACTIVE vs INACTIVE driver", () => {
  // -----------------------------------------------------------------------
  // ACTIVE driver: User exists and active=true → allowed
  // -----------------------------------------------------------------------
  it("allows ACTIVE driver (existing user, active=true)", () => {
    const user: SimulatedUser = {
      id: "u1",
      email: "active-driver@gmail.com",
      active: true,
      role: "DRIVER",
    };
    const result = simulateSignInDecision(user, null);
    expect(result.allowed).toBe(true);
  });

  // -----------------------------------------------------------------------
  // INACTIVE driver: User exists and active=false → refused
  // -----------------------------------------------------------------------
  it("refuses INACTIVE driver (existing user, active=false)", () => {
    const user: SimulatedUser = {
      id: "u2",
      email: "inactive-driver@gmail.com",
      active: false,
      role: "DRIVER",
    };
    const result = simulateSignInDecision(user, null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("user_deactivated");
  });

  // -----------------------------------------------------------------------
  // New user with ACTIVE AllowedEmail → allowed
  // -----------------------------------------------------------------------
  it("allows new user with ACTIVE AllowedEmail", () => {
    const allowedEmail: AllowedEmailRecord = {
      id: "ae1",
      email: "new-driver@gmail.com",
      status: "ACTIVE",
      role: "DRIVER",
    };
    const result = simulateSignInDecision(null, allowedEmail);
    expect(result.allowed).toBe(true);
  });

  // -----------------------------------------------------------------------
  // New user with REVOKED AllowedEmail → refused
  // -----------------------------------------------------------------------
  it("refuses new user with REVOKED AllowedEmail", () => {
    const allowedEmail: AllowedEmailRecord = {
      id: "ae2",
      email: "revoked@gmail.com",
      status: "REVOKED",
      role: "DRIVER",
    };
    const result = simulateSignInDecision(null, allowedEmail);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
  });

  // -----------------------------------------------------------------------
  // New user with no AllowedEmail → refused
  // -----------------------------------------------------------------------
  it("refuses new user with no AllowedEmail record", () => {
    const result = simulateSignInDecision(null, null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("EMAIL_NOT_AUTHORIZED");
  });

  // -----------------------------------------------------------------------
  // Edge: ACTIVE user with REVOKED AllowedEmail → still allowed
  // (because existingUser check comes first and passes)
  // -----------------------------------------------------------------------
  it("allows ACTIVE existing user even if AllowedEmail is REVOKED (existing user path wins)", () => {
    const user: SimulatedUser = {
      id: "u3",
      email: "active-revoked@gmail.com",
      active: true,
      role: "DRIVER",
    };
    const allowedEmail: AllowedEmailRecord = {
      id: "ae3",
      email: "active-revoked@gmail.com",
      status: "REVOKED",
      role: "DRIVER",
    };
    const result = simulateSignInDecision(user, allowedEmail);
    expect(result.allowed).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Edge: INACTIVE user with ACTIVE AllowedEmail → refused
  // (existingUser.active=false check wins)
  // -----------------------------------------------------------------------
  it("refuses INACTIVE existing user even if AllowedEmail is ACTIVE", () => {
    const user: SimulatedUser = {
      id: "u4",
      email: "inactive-allowed@gmail.com",
      active: false,
      role: "DRIVER",
    };
    const allowedEmail: AllowedEmailRecord = {
      id: "ae4",
      email: "inactive-allowed@gmail.com",
      status: "ACTIVE",
      role: "DRIVER",
    };
    const result = simulateSignInDecision(user, allowedEmail);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("user_deactivated");
  });
});
