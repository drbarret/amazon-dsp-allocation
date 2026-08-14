-- Migration: add dispatch planning tables (DispatchWeek, Vacancy, DispatchAssignment)
-- Generated for Prisma and applied via scripts/apply-migration.mjs

-- Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchWeekStatus') THEN
        CREATE TYPE "DispatchWeekStatus" AS ENUM ('PLANNING', 'OPEN', 'CLOSED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentStatus') THEN
        CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
    END IF;
END $$;

-- DispatchWeek
CREATE TABLE IF NOT EXISTS "dispatch_weeks" (
    "id" TEXT NOT NULL,
    "transportCompanyId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "DispatchWeekStatus" NOT NULL DEFAULT 'PLANNING',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_weeks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_weeks_transportCompanyId_year_weekNumber_key"
    ON "dispatch_weeks"("transportCompanyId", "year", "weekNumber");
CREATE INDEX IF NOT EXISTS "dispatch_weeks_weekKey_idx"
    ON "dispatch_weeks"("weekKey");

-- Vacancy
CREATE TABLE IF NOT EXISTS "vacancies" (
    "id" TEXT NOT NULL,
    "dispatchWeekId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "shiftBlock" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vacancies_dispatchWeekId_date_vehicleType_shiftBlock_key"
    ON "vacancies"("dispatchWeekId", "date", "vehicleType", "shiftBlock");
CREATE INDEX IF NOT EXISTS "vacancies_dispatchWeekId_date_idx"
    ON "vacancies"("dispatchWeekId", "date");

-- DispatchAssignment
CREATE TABLE IF NOT EXISTS "dispatch_assignments" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_assignments_vacancyId_driverProfileId_key"
    ON "dispatch_assignments"("vacancyId", "driverProfileId");
CREATE INDEX IF NOT EXISTS "dispatch_assignments_driverProfileId_idx"
    ON "dispatch_assignments"("driverProfileId");

-- Foreign keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dispatch_weeks_transportCompanyId_fkey'
    ) THEN
        ALTER TABLE "dispatch_weeks"
            ADD CONSTRAINT "dispatch_weeks_transportCompanyId_fkey"
            FOREIGN KEY ("transportCompanyId") REFERENCES "transport_companies"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'vacancies_dispatchWeekId_fkey'
    ) THEN
        ALTER TABLE "vacancies"
            ADD CONSTRAINT "vacancies_dispatchWeekId_fkey"
            FOREIGN KEY ("dispatchWeekId") REFERENCES "dispatch_weeks"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dispatch_assignments_vacancyId_fkey'
    ) THEN
        ALTER TABLE "dispatch_assignments"
            ADD CONSTRAINT "dispatch_assignments_vacancyId_fkey"
            FOREIGN KEY ("vacancyId") REFERENCES "vacancies"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dispatch_assignments_driverProfileId_fkey'
    ) THEN
        ALTER TABLE "dispatch_assignments"
            ADD CONSTRAINT "dispatch_assignments_driverProfileId_fkey"
            FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dispatch_assignments_assignedByUserId_fkey'
    ) THEN
        ALTER TABLE "dispatch_assignments"
            ADD CONSTRAINT "dispatch_assignments_assignedByUserId_fkey"
            FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
