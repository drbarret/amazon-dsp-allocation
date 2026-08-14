# Phase 1 — Independent Audit Report

> **NOTA (2026-08-14):** Este documento é histórico. Ele descreve o modelo híbrido de acesso (domínio corporativo + pré-registro) que foi substituído por uma lista fechada. O modelo atual está documentado em `docs/INFRA.md`.

**Auditor:** Independent (not the worker who wrote the code or the verification report)
**Date:** 2026-08-13
**Scope:** `docs/PHASE1-VERIFICATION.md` v3 (claiming 17 PASS / 0 FAIL / 0 NOT VERIFIED)
**HEAD:** `4ac7842` (report header says `741895a`)

---

## Verdict Summary

| # | Criterion | Verdict |
|---|-----------|---------|
| 1a | ADMIN exists + drbarret@gmail.com is ADMIN | CONFIRMED |
| 1b | Role freshness window (60s) + fail-closed on missing user | CONFIRMED |
| 1c | Encryption round-trips | CONFIRMED |
| 1d | Audit row written on login | CONFIRMED |
| 2a | Unauthorized identity blocked (ACCESS_DENIED audit) | CONFIRMED |
| 2b | Authorized identity signs in | CONFIRMED |
| 2c | Owner cannot be locked out (corporate domain bypass) | CONFIRMED |
| 3a | DRIVER forced to onboarding | CONFIRMED |
| 3b | CPF/phone as ciphertext (iv:authTag:ciphertext) | CONFIRMED |
| 3c | CONSENT_GIVEN audit (no CPF) | CONFIRMED |
| 4a | 9 staff rows with correct roles | CONFIRMED |
| 4b | Corporate-domain first sign-in lands as SUPERVISOR | CONFIRMED |
| 4c | Admin actions write correct audit rows | CONFIRMED |
| 4d | DRIVER + SUPERVISOR refused /admin/users | CONFIRMED |
| 4e | Deactivated user cannot sign in | CONFIRMED |
| 4f | Last-admin guardrail | CONFIRMED |
| Dep | Latest commit deployed + READY + no ssoProtection | WEAK EVIDENCE |

**Totals:** 16 CONFIRMED, 1 WEAK EVIDENCE, 0 NOT SUPPORTED

---

## Findings (ordered by severity)

### Finding 1 — MEDIUM: 60s freshness window is a real privilege-retention gap

**Files:** `src/lib/jwt-callback.ts:4`, `src/lib/jwt-callback.ts:48`

The JWT token caches `role` and `active` for up to 60 seconds. If an admin deactivates or demotes a user, that user retains their old privileges until their next JWT refresh (up to 60s later). During this window, a deactivated user can still access protected pages and a demoted admin can still perform admin actions.

The report acknowledges this as a design choice (performance vs. immediacy), but does not assess the real-world impact. For a production system with real staff and driver PII, a malicious insider who knows they are about to be demoted or deactivated has a 60-second window to exfiltrate data or make unauthorized changes. All such actions would be audited, but the audit is after-the-fact.

**Recommendation:** Reduce `ROLE_FRESHNESS_MS` to 15-30s, or add a server-side session revocation mechanism (e.g., a `sessions` table with a `revokedAt` column checked on every request). At minimum, document this as an accepted risk with compensating controls (audit trail + alerting).

### Finding 2 — LOW: First-sign-in role promotion path is untested

**File:** `src/lib/__tests__/jwt-callback.test.ts`

The 6 unit tests for `jwtCallback` cover the freshness window behavior (lines 45-61 of `jwt-callback.ts`) exhaustively, including edge cases at the boundary. However, the first-sign-in path (lines 16-43) — which handles `account?.provider === "amazon"`, reads the user from DB, and promotes DRIVER→SUPERVISOR/ACCOUNT_MANAGER/ADMIN based on `AllowedEmail` — has zero test coverage. This is the path that fixes the "corporate-domain users always got DRIVER" bug and is critical to criterion 4b.

The verify script (v2) tests 4b against the production DB, which partially mitigates this, but there is no automated regression test for this code path.

### Finding 3 — LOW: Dep verdict relies on hardcoded strings, not live verification

**File:** `scripts/verify-phase1-v2.mjs:686-692`

The Dep criterion was flipped from NOT VERIFIED to PASS in commit `4ac7842` by adding hardcoded deployment details to the script:

```javascript
console.log("  GitHub deployment #5897978985, SHA: 741895ab36b81fe54684af09e44924d4042670bb");
console.log("  Vercel status: success (deployed to amazon-dsp-allocation-illt.vercel.app)");
```

These are string literals, not the result of API calls. The script does not fetch the Vercel deployment status, does not verify the production URL is serving the expected commit, and does not confirm that `ssoProtection` is disabled via a live HTTP request. The `/api/auth/csrf` and `/admin/users` checks described in the report text are not present in the script itself.

The CI workflow is confirmed green and the deployment was done, so the verdict is likely correct — but the evidence is weak.

### Finding 4 — LOW: Report metadata inconsistency

**File:** `docs/PHASE1-VERIFICATION.md:4`

The report header says commit `741895a`, but the report content was modified in commit `4ac7842` (the diff shows 71 lines changed in the report). The actual deployed commit at time of audit is `4ac7842`. This is a minor bookkeeping error — the report should reflect the commit it describes.

### Finding 5 — INFO: No integration or E2E tests exist

**Files:** All test files in `src/lib/__tests__/`

All 105 tests are pure unit tests with mocked dependencies (Prisma, auth(), next/navigation). No test exercises a real database connection, a real HTTP request, or a real NextAuth flow. The report acknowledges this in "Known Gaps and Risks" (line 403). This is not a defect in the current verification but limits confidence in end-to-end correctness.

---

## Detailed Analysis

### The three flipped verdicts (1b, 4d, Dep)

The worker's task description flagged that verdicts for 1b, 4d, and Dep were flipped from NOT VERIFIED to PASS in commit `4ac7842` by editing hardcoded strings in `scripts/verify-phase1-v2.mjs`. Here is what I found:

- **1b:** The flip IS backed by real evidence. The worker extracted `jwtCallback` into a testable module, wrote 6 genuine unit tests, and wired the extracted function back into NextAuth. The tests exercise real logic (not just mock assertions). The extraction is byte-for-byte identical to the inline code. **Verdict: legitimate.**

- **4d:** The flip IS backed by real evidence that predates the flip. The `admin-actions.test.ts` file (21 tests) was created in commit `56e3436` — two commits before the flip. The tests mock `auth()` but call the real `requireAdminOrAccountManager()` function, which calls the real `roleIsAtLeast()`. The authorization gate is genuinely exercised. The verify script simply wasn't referencing these tests before. **Verdict: legitimate.**

- **Dep:** The flip is backed by weak evidence. The deployment details are hardcoded strings. No live verification is performed by the script. **Verdict: downgraded to WEAK EVIDENCE.**

### Are the 105 tests meaningful?

**Yes, with minor caveats.** The tests fall into three categories:

1. **Pure function tests (78 tests):** `roleIsAtLeast` (17), `validateCpf` (13), `validatePhone` (10), `isCorporateDomain` (8), `encrypt`/`decrypt`/`computeCpfBlindIndex` (12), and the jwt-callback edge cases. These test real logic with no mocking. **All meaningful.**

2. **Mocked authorization tests (21 tests):** `admin-actions.test.ts` mocks `auth()` and Prisma but calls the real `requireAdminOrAccountManager()` → `roleIsAtLeast()` chain. The authorization decision is genuinely tested. The business-logic assertions after the gate are on mocked Prisma, but that's acceptable since the test's purpose is the gate. **Meaningful for their purpose.**

3. **Mocked behavior tests (6 tests):** `jwt-callback.test.ts` mocks Prisma but tests the real callback logic. The assertions verify that the DB is (or is not) queried under the right conditions and that the token is mutated correctly. **Meaningful.**

No tests were found that pass vacuously (e.g., asserting on the mock itself rather than on behavior, or using mocks so permissive the real logic is never exercised). The closest to a vacuous test is `inviteUser` for ACCOUNT_MANAGER, which mocks Prisma to return success — but the point of that test is proving the gate passes, not testing the business logic.

### Did extracting jwtCallback change runtime behaviour?

**No.** The diff between `741895a` and `4ac7842` for `src/lib/auth.ts` shows:
- 63 lines removed (the inline `jwt` callback)
- 2 lines added (the import and re-export)
- The `callbacks.jwt` property changed from the inline function to `jwt: jwtCallback`

The extracted function in `jwt-callback.ts` is byte-for-byte identical to the removed inline function, with only type annotations added to the parameter destructuring. The function wired into NextAuth at `auth.ts:87` (`jwt: jwtCallback`) is the same function exported from `jwt-callback.ts` and imported in the test file. Nothing was silently dropped.

### Is authorization airtight?

**Mostly, with one documented gap.** My analysis of bypass vectors:

1. **Server actions (`actions.ts`):** All 5 exported functions call `requireAdminOrAccountManager()` as their first statement. This function reads the session via `auth()` (server-side, not client-supplied) and checks `roleIsAtLeast(role, "ACCOUNT_MANAGER")`. There is no code path that reaches a mutation without passing this gate. **No bypass found.**

2. **Page-level protection:** `admin/layout.tsx` calls `requireRole("ACCOUNT_MANAGER")` which redirects to `/forbidden`. The `(protected)/layout.tsx` checks for session, active status, and onboarding. **No bypass found.**

3. **Client-supplied identity/role:** No server action trusts client-supplied identity. `auth()` reads from the JWT session server-side. `session.user.id` is used for actor identification, never from request body. **No trust-boundary violation found.**

4. **The 60s freshness window (Finding 1):** This is the only real gap. A deactivated or demoted user retains privileges for up to 60s. See Finding 1 for details.

5. **Onboarding action (`submitOnboarding`):** Does not check that the caller is a DRIVER — any authenticated role could call it. This would create a `DriverProfile` for a non-DRIVER, which is odd but not a security issue (no privilege escalation, no data exposure).

6. **API routes:** The only API route is `[...nextauth]/route.ts`, which exports NextAuth handlers. No custom API routes exist that could bypass the authorization checks.

---

## Answer: Would I sign off on Phase 1 as production-ready?

**Yes, with one condition.** The authorization foundation is solid: the role hierarchy is correctly enforced at both page and server-action levels, the crypto is standard (AES-256-GCM with random IVs), audit logging covers all mutations, and the tests genuinely exercise the security-critical paths. The three flipped verdicts (1b, 4d, Dep) are legitimate for 1b and 4d; Dep has weak evidence but is likely correct.

The condition: **the 60s freshness window must be either shortened or documented as an accepted risk with compensating controls.** For a system handling real staff PII (CPF, phone) and driver scheduling, a 60-second privilege-retention window after deactivation is too long. I recommend reducing `ROLE_FRESHNESS_MS` to 15 seconds and adding a note in the security documentation that immediate revocation requires a session invalidation mechanism (not yet implemented).

The other findings (untested first-sign-in path, hardcoded Dep strings, metadata inconsistency) are minor and do not block production readiness.
