-- Migration: CNH collection becomes a manual supervisor action (history)
--
-- Context (decision 2026-08-15):
--   - The automatic 30-day-before-expiry reminder email is REMOVED. There is
--     no schedule, cron, or window anymore. The supervisor deliberately
--     selects which drivers to charge and clicks "Cobrar CNH atualizada".
--   - Re-send is allowed (the supervisor may need to charge again someone who
--     ignored the email), so the unique (driverProfileId, cnhExpiration)
--     constraint is dropped. cnh_reminders becomes a HISTORY table: every
--     send appends a row with a timestamp and the actor who triggered it.
--   - A new audit event type CNH_COLLECTED records each collection with the
--     actor and recipient count (no PII in the log).

-- 1. New audit event type
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CNH_COLLECTED';

-- 2. Drop the idempotency unique constraint (re-send is now allowed)
DROP INDEX IF EXISTS "cnh_reminders_driverProfileId_cnhExpiration_key";

-- 3. Attribute each collection to the supervisor who triggered it
ALTER TABLE "cnh_reminders" ADD COLUMN IF NOT EXISTS "actorId" TEXT;
