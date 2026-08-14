-- Migration: Add BLOCKED status for two-layer access control
-- 
-- Context: Previously, inactive drivers had AllowedEmail.status = 'ACTIVE'
-- and relied solely on User.active = false for blocking. This left a
-- single-layer defense with a confirmed escape path (delete User row →
-- PrismaAdapter recreates with active=true → inactive driver gets in).
--
-- This migration:
-- 1. Sets AllowedEmail.status = 'BLOCKED' for all inactive drivers
--    (those whose User row has active = false).
-- 2. Is idempotent: running it twice produces the same result.
--
-- After this migration:
--   Layer 1: AllowedEmail.status must be 'ACTIVE' (authorizeSignIn)
--   Layer 2: User.active must be true (signIn callback)
--   Both layers must pass for login to succeed.

-- Update inactive drivers' AllowedEmail from ACTIVE to BLOCKED
-- Only touches rows where the user exists and is inactive.
-- Does NOT touch REVOKED rows or rows without a matching user.
UPDATE "allowed_emails"
SET "status" = 'BLOCKED', "updatedAt" = now()
WHERE "status" = 'ACTIVE'
  AND "email" IN (
    SELECT "email" FROM "users" WHERE "active" = false
  );
