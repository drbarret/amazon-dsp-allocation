-- Migration: Add driver infractions (new behavior model)
--
-- Context: The old behavior model (BehaviorRecord + DriverProfile.behaviorApprovedCount)
-- implemented a "mark -> approve -> deactivate after 3" workflow that the user
-- replaced on 2026-08-14. The new rule (docs/plans/driver-behavior-and-allocation-rules.md §3):
--   - 5 infraction types; the punishment is determined by the TYPE, never by the supervisor.
--   - The subjective type (RECLAMACAO_ASPERA) requires account-manager approval.
--   - The punishment applies the week AFTER the mark and stays pending until the
--     driver actually loses a vacancy (it never expires on its own).
--   - Recidivism doubles the punishment and triggers supervisor warning -> escalation.
--   - Deactivation is never automatic; who deactivates determines who can reactivate.
--
-- The old behavior_records table is empty (0 rows) and its workflow is obsolete,
-- so it is dropped. behaviorApprovedCount (the "3 marks = deactivate" counter) is
-- removed. User gains deactivatedById/deactivatedByRole to enforce the reactivation rule.

-- 1. New enums
CREATE TYPE "InfractionType" AS ENUM (
  'NAO_REVERTER_INSUCESSOS',
  'RECLAMACAO_ASPERA',
  'FALTAS_RECORRENTES',
  'ABANDONO_ROTA',
  'DESCUMPRIR_REGRAS_AMAZON'
);

CREATE TYPE "InfractionStatus" AS ENUM (
  'PENDING_APPROVAL',
  'ACTIVE',
  'FULFILLED',
  'CANCELLED'
);

-- 2. Drop the obsolete behavior_records table (empty) and its indexes
DROP TABLE IF EXISTS "behavior_records";

-- 3. Drop the now-unused BehaviorType enum
DROP TYPE IF EXISTS "BehaviorType";

-- 4. Remove the obsolete "3 marks = deactivate" counter
ALTER TABLE "driver_profiles" DROP COLUMN IF EXISTS "behaviorApprovedCount";

-- 5. Track who deactivated a user (for the reactivation rule)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivatedById" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivatedByRole" "UserRole";

-- 6. New driver_infractions table
CREATE TABLE "driver_infractions" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "type" "InfractionType" NOT NULL,
    "observation" TEXT,
    "weekKey" TEXT NOT NULL,
    "effectiveWeekKey" TEXT NOT NULL,
    "effectiveStartDate" DATE NOT NULL,
    "effectiveEndDate" DATE NOT NULL,
    "status" "InfractionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "multiplier" INTEGER NOT NULL DEFAULT 1,
    "weeksServed" INTEGER NOT NULL DEFAULT 0,
    "markedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "supervisorNotifiedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_infractions_pkey" PRIMARY KEY ("id")
);

-- 7. New audit event types
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'INFRACTION_MARKED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'INFRACTION_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'INFRACTION_REJECTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'INFRACTION_FULFILLED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'RECIDIVISM_WARNING';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'RECIDIVISM_ESCALATED';

-- 8. Foreign keys and indexes
ALTER TABLE "driver_infractions" ADD CONSTRAINT "driver_infractions_driverProfileId_fkey"
    FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_infractions" ADD CONSTRAINT "driver_infractions_markedById_fkey"
    FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "driver_infractions" ADD CONSTRAINT "driver_infractions_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "driver_infractions_driverProfileId_effectiveStartDate_effectiveEndDate_idx"
    ON "driver_infractions"("driverProfileId", "effectiveStartDate", "effectiveEndDate");
CREATE INDEX "driver_infractions_status_idx" ON "driver_infractions"("status");
