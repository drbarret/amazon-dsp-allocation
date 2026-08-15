-- Migration: CNH reminder emails + audit events for supervisor edits
--
-- Context:
--   - Supervisors can now edit a driver's CNH expiry date and city
--     preferences. Each edit is audited, so two new AuditEventType values
--     are added: CNH_UPDATED and CITY_PREFERENCES_UPDATED.
--   - A 30-day-before-expiry reminder email is sent to drivers via Resend.
--     Idempotency is enforced by a unique (driverProfileId, cnhExpiration)
--     constraint: a driver receives at most one reminder per distinct CNH
--     expiry date.

-- 1. New audit event types
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CNH_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CITY_PREFERENCES_UPDATED';

-- 2. New cnh_reminders table
CREATE TABLE "cnh_reminders" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "cnhExpiration" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CNH_EXPIRY_30D',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cnh_reminders_pkey" PRIMARY KEY ("id")
);

-- 3. Foreign keys and indexes
ALTER TABLE "cnh_reminders" ADD CONSTRAINT "cnh_reminders_driverProfileId_fkey"
    FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "cnh_reminders_driverProfileId_cnhExpiration_key"
    ON "cnh_reminders"("driverProfileId", "cnhExpiration");
CREATE INDEX "cnh_reminders_driverProfileId_idx" ON "cnh_reminders"("driverProfileId");
