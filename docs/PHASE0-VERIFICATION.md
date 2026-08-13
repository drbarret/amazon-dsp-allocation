# Phase 0 — Bootstrap Verification Report

**Date:** 2026-08-13
**Project:** Amazon DSP Driver Allocation System
**Repository:** [drbarret/amazon-dsp-allocation](https://github.com/drbarret/amazon-dsp-allocation)
**Branch:** `main` (commit `1995938`)

---

## 1. Repository & Next.js Skeleton

| Item | Value |
|---|---|
| Repository URL | `https://github.com/drbarret/amazon-dsp-allocation.git` |
| Framework | Next.js 16.3.0 (Turbopack) |
| Runtime | Node.js 24.x (Vercel) |
| Package manager | npm |
| Lint | ESLint — **passing** |
| Type check | `tsc --noEmit` — **passing** |
| Build | `next build` — **passing** (10.3s compile, 4.4s typecheck) |
| Routes | `/` (static), `/login` (static), `/dashboard` (dynamic), `/api/auth/[...nextauth]` (dynamic) |

---

## 2. PostgreSQL (Supabase)

| Item | Value |
|---|---|
| Provider | Supabase |
| Region | `sa-east-1` (São Paulo) |
| PostgreSQL version | 17.6 |
| Connection | Transaction pooler (`aws-0-sa-east-1.pooler.supabase.com:6543`) |
| Adapter | `@prisma/adapter-pg` (pgBouncer mode, `connection_limit=1`) |
| Connectivity | ✅ Verified via `scripts/test-db.mjs` |

### Migration Workaround

`prisma migrate dev` fails against the Supabase transaction pooler with:
```
prepared statement "s1" already exists
```

**Required workaround:** Generate SQL with `npx prisma migrate diff` (or hand-write it), then apply with `node scripts/apply-migration.mjs`. This script connects via `pg.Client`, runs the SQL in a transaction, and records the migration in `_prisma_migrations`.

---

## 3. Redis (Upstash)

| Item | Value |
|---|---|
| Provider | Upstash |
| Region | `sa-east-1` |
| Host | `epic-pup-135844.upstash.io:6379` |
| Connectivity | ✅ `PONG` via `scripts/test-redis.mjs` |

---

## 4. Prisma Schema & Migrations

| Item | Value |
|---|---|
| Models | 21 |
| Enums | 12 |
| Tables in DB | 22 (includes `_prisma_migrations`) |
| Client output | `src/generated/prisma` |
| Client version | Prisma 7.9.1 |

### Applied Migrations (in order)

1. `20260811164000_init` — Full schema from `plans/data-model.md`
2. `20260812020000_add_nextauth` — Account, Session, VerificationToken models
3. `20260812020100_user_role_default` — `UserRole` default to `DRIVER`
4. `20260812030000_add_user_image` — Added `image TEXT` to `users` (Auth.js adapter fix #1)
5. `20260813010000_make_email_verified_nullable` — Made `emailVerified` nullable (Auth.js adapter fix #2)
6. `20260813020000_change_email_verified_to_datetime` — Changed `emailVerified` from `BOOLEAN` to `TIMESTAMP` (Auth.js adapter fix #3)

---

## 5. Vercel Deployment

| Item | Value |
|---|---|
| Project ID | `prj_4Ob56IBdtUA2qQsSDrCQXZUBac9i` |
| Org | `illt` (team) |
| Framework preset | Next.js (auto-detected) |
| Node version | 24.x |
| Build command | `next build` (via `vercel build`) |
| Output directory | `.next` (standard) |
| Production URL | `https://amazon-dsp-allocation-illt.vercel.app` |
| HTTP status | `GET /` → 200, `GET /login` → 200, `GET /dashboard` (unauthenticated) → 307 → `/login` |

### ⚠️ Domain Collision Warning

`https://amazon-dsp-allocation.vercel.app` is a **404 domain collision** — it belongs to a different Vercel account. Always use the full project slug URL: `https://amazon-dsp-allocation-illt.vercel.app`.

### Deployment Protection

**Disabled.** Vercel Deployment Protection silently intercepts `/api/auth/*` routes with a password challenge, breaking the OAuth callback. It was disabled in commit `50852d3`.

---

## 6. GitHub Actions CI

| Item | Value |
|---|---|
| Workflow file | `.github/workflows/ci.yml` |
| Triggers | Push to `main`, PR to `main` |
| Jobs | `lint-typecheck-build` (required), `test` (optional) |

### `test` job

The test job has `continue-on-error: true` and runs `vitest --run --passWithNoTests`. This must be changed to `continue-on-error: false` once real tests exist. Currently there are no test files.

---

## 7. Login with Amazon (LWA) OAuth2

| Item | Value |
|---|---|
| Library | Auth.js v5 (`next-auth@5.0.0-beta`) |
| Provider | Custom OAuth provider (`id: "amazon"`) |
| Authorization URL | `https://www.amazon.com/ap/oa` |
| Token URL | `https://api.amazon.com/auth/o2/token` |
| Userinfo URL | `https://api.amazon.com/user/profile` |
| Scope | `profile` |
| Session strategy | **JWT** (not database sessions) |
| Adapter | `@auth/prisma-adapter` (used for user/account persistence on first sign-in) |
| `trustHost` | `true` (required for Vercel deployment behind reverse proxy) |

### Why JWT Strategy

The Prisma adapter with `@prisma/adapter-pg` is incompatible with Next.js Edge middleware. JWT sessions avoid database calls in middleware, keeping the app deployable on Vercel's Edge network.

### Registered Callback URLs (Amazon Developer Console)

- Return URL: `https://amazon-dsp-allocation-illt.vercel.app/api/auth/callback/amazon`
- Allowed Origin: `https://amazon-dsp-allocation-illt.vercel.app`

### Schema Mismatches Found & Fixed

Auth.js's Prisma adapter passes profile fields directly to `prisma.user.create()`. Three schema mismatches were discovered and fixed:

| # | Field | Was | Changed To | Reason |
|---|---|---|---|---|
| 1 | `image` | Missing | `String?` | `profile()` returns `image: null`; adapter passes it to `createUser` |
| 2 | `emailVerified` | `Boolean @default(false)` (non-null) | `Boolean?` | Adapter passes `null` on first OAuth sign-in; non-nullable Boolean rejects it |
| 3 | `emailVerified` | `Boolean?` | `DateTime?` | Auth.js `AdapterUser` spec declares `emailVerified: Date \| null`; `updateUser` may pass a `Date` |

### End-to-End Login Confirmation

A real Login with Amazon OAuth flow completed successfully on **2026-08-13**:

- User row created: `id=78b18e88`, name="Daniel Ribeiro Barreto", email="dr***@gmail.com", role="DRIVER"
- Account row created: `provider=amazon`, `providerAccountId=...6XRQ`, `type=oauth`
- User landed on `/dashboard` and saw their name, email, and sign-out button

---

## 8. Environment Variables (Vercel)

Variables configured across all environments (Production, Preview, Development):

| Name | Type | Environments |
|---|---|---|
| `DATABASE_URL` | Sensitive | Production, Preview, Development |
| `REDIS_URL` | Sensitive | Production, Preview, Development |
| `AUTH_URL` | Sensitive | Production, Preview, Development |
| `AUTH_SECRET` | Sensitive | Production, Preview, Development |
| `AUTH_AMAZON_ID` | Sensitive | Production, Preview, Development |
| `AUTH_AMAZON_SECRET` | Sensitive | Production, Preview, Development |
| `NEXTAUTH_SECRET` | Non-sensitive | Development only (legacy) |
| `NEXTAUTH_URL` | Non-sensitive | Development only (legacy) |

> **Note:** `NEXTAUTH_SECRET` and `NEXTAUTH_URL` are legacy variables from an earlier Auth.js v4 attempt. They are only set in Development and are not used by the current Auth.js v5 configuration.

---

## 9. Known Gaps & Blockers

### WhatsApp Business API
Connectivity check **not done**. Requires Meta Business Manager credentials from the user. The `WhatsAppMessage` model and `WhatsAppMessageStatus` enum are defined in the schema but no integration code exists yet.

### Automated Tests
No test files exist. The CI `test` job runs `vitest --passWithNoTests` with `continue-on-error: true`. This must be hardened once real tests are written.

### Role Changes Require Re-Login
The `jwt` callback in `src/lib/auth.ts` reads `role` from the database **only on first sign-in** (when `account?.provider === "amazon"`). Subsequent token refreshes do not re-read the role. If an admin changes a user's role, that user must sign out and sign in again for the new role to appear in their session.

### User Role Enum
The `UserRole` enum has three values: `DRIVER`, `SUPERVISOR`, `ACCOUNT_MANAGER`. There is no `ADMIN` role. The system owner was promoted to `ACCOUNT_MANAGER` (the highest available role). A dedicated `ADMIN` role should be added to the enum when the authorization system is implemented.

---

## Lessons Learned / Rules for This Project

1. **Supabase Pooler Migration Workaround:** `prisma migrate dev` fails against the Supabase transaction pooler. Always use `npx prisma migrate diff` (or hand-written SQL) + `node scripts/apply-migration.mjs`.

2. **Auth.js Adapter Field Compatibility:** The Prisma adapter passes all profile fields directly to `prisma.user.create()`. Every field returned by `profile()` must exist in the `User` model with a compatible type and nullability. The canonical Auth.js schema declares `emailVerified` as `DateTime?`, not `Boolean`.

3. **Vercel Deployment Protection Silently Breaks OAuth:** Deployment Protection intercepts `/api/auth/*` routes with a password challenge, causing the OAuth callback to fail with no visible error. It must be disabled for OAuth to work.

4. **JWT Strategy Required for Edge:** The Prisma adapter with `@prisma/adapter-pg` is incompatible with Next.js Edge middleware. Use `strategy: "jwt"` and protect pages at the component level.

5. **`trustHost: true` Required on Vercel:** Without it, Auth.js rejects the callback because the `Host` header doesn't match the expected origin behind Vercel's reverse proxy.

6. **Domain Collision on Vercel:** The short project URL (`amazon-dsp-allocation.vercel.app`) may collide with another account. Always use the full slug (`amazon-dsp-allocation-illt.vercel.app`).
