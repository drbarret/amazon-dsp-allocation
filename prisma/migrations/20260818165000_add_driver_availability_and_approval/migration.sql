-- Migration: add driver availability and approval tables
-- Generated manually because Prisma schema-engine commands hang against the
-- Supabase transaction pooler in this environment. The SQL below mirrors the
-- Prisma models DriverAvailability and AvailabilityApproval.

-- Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AvailabilityApprovalStatus') THEN
        CREATE TYPE "AvailabilityApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
    END IF;
END $$;

-- DriverAvailability
CREATE TABLE IF NOT EXISTS "driver_availabilities" (
    "id" TEXT NOT NULL,
    "dispatchWeekId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filledAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT,
    "hasNaturalGas" BOOLEAN NOT NULL DEFAULT false,
    "isPassengerCar" BOOLEAN NOT NULL DEFAULT false,
    "sunAvailable" BOOLEAN NOT NULL DEFAULT false,
    "monAvailable" BOOLEAN NOT NULL DEFAULT false,
    "tueAvailable" BOOLEAN NOT NULL DEFAULT false,
    "wedAvailable" BOOLEAN NOT NULL DEFAULT false,
    "thuAvailable" BOOLEAN NOT NULL DEFAULT false,
    "friAvailable" BOOLEAN NOT NULL DEFAULT false,
    "satAvailable" BOOLEAN NOT NULL DEFAULT false,
    "speedAfternoon" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_availabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "driver_availabilities_dispatchWeekId_userId_key"
    ON "driver_availabilities"("dispatchWeekId", "userId");
CREATE INDEX IF NOT EXISTS "driver_availabilities_dispatchWeekId_userId_idx"
    ON "driver_availabilities"("dispatchWeekId", "userId");
CREATE INDEX IF NOT EXISTS "driver_availabilities_userId_dispatchWeekId_idx"
    ON "driver_availabilities"("userId", "dispatchWeekId");

-- AvailabilityApproval
CREATE TABLE IF NOT EXISTS "availability_approvals" (
    "id" TEXT NOT NULL,
    "driverAvailabilityId" TEXT NOT NULL,
    "status" "AvailabilityApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "availability_approvals_driverAvailabilityId_key"
    ON "availability_approvals"("driverAvailabilityId");
CREATE INDEX IF NOT EXISTS "availability_approvals_status_idx"
    ON "availability_approvals"("status");
CREATE INDEX IF NOT EXISTS "availability_approvals_reviewerId_idx"
    ON "availability_approvals"("reviewerId");

-- Foreign keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'driver_availabilities_dispatchWeekId_fkey'
    ) THEN
        ALTER TABLE "driver_availabilities"
            ADD CONSTRAINT "driver_availabilities_dispatchWeekId_fkey"
            FOREIGN KEY ("dispatchWeekId") REFERENCES "dispatch_weeks"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'driver_availabilities_userId_fkey'
    ) THEN
        ALTER TABLE "driver_availabilities"
            ADD CONSTRAINT "driver_availabilities_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'driver_availabilities_importedById_fkey'
    ) THEN
        ALTER TABLE "driver_availabilities"
            ADD CONSTRAINT "driver_availabilities_importedById_fkey"
            FOREIGN KEY ("importedById") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'availability_approvals_driverAvailabilityId_fkey'
    ) THEN
        ALTER TABLE "availability_approvals"
            ADD CONSTRAINT "availability_approvals_driverAvailabilityId_fkey"
            FOREIGN KEY ("driverAvailabilityId") REFERENCES "driver_availabilities"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'availability_approvals_reviewerId_fkey'
    ) THEN
        ALTER TABLE "availability_approvals"
            ADD CONSTRAINT "availability_approvals_reviewerId_fkey"
            FOREIGN KEY ("reviewerId") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
