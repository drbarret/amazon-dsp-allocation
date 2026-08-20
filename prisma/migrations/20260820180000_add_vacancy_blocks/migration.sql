-- Migration: add VacancyBlock and BlockDailyVacancy tables for manual weekly
-- vacancy planning by block. Applied via scripts/apply-migration.mjs

-- Enum for vehicle eligibility (stored as Postgres array on VacancyBlock)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleEligibility') THEN
        CREATE TYPE "VehicleEligibility" AS ENUM ('GNV', 'CARGO_VAN', 'PASSENGER');
    END IF;
END $$;

-- VacancyBlock: configurable catalog of blocks per transport company
CREATE TABLE IF NOT EXISTS "vacancy_blocks" (
    "id" TEXT NOT NULL,
    "transportCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "eligibleVehicleTypes" "VehicleEligibility"[] NOT NULL DEFAULT '{}',
    "shift" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "vacancy_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vacancy_blocks_transportCompanyId_active_sortOrder_idx"
    ON "vacancy_blocks"("transportCompanyId", "active", "sortOrder");

-- BlockDailyVacancy: daily vacancy count per block per dispatch week
CREATE TABLE IF NOT EXISTS "block_daily_vacancies" (
    "id" TEXT NOT NULL,
    "dispatchWeekId" TEXT NOT NULL,
    "vacancyBlockId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "block_daily_vacancies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "block_daily_vacancies_dispatchWeekId_vacancyBlockId_dayOfWeek_key"
    ON "block_daily_vacancies"("dispatchWeekId", "vacancyBlockId", "dayOfWeek");
CREATE INDEX IF NOT EXISTS "block_daily_vacancies_dispatchWeekId_vacancyBlockId_idx"
    ON "block_daily_vacancies"("dispatchWeekId", "vacancyBlockId");
CREATE INDEX IF NOT EXISTS "block_daily_vacancies_vacancyBlockId_idx"
    ON "block_daily_vacancies"("vacancyBlockId");

-- Foreign keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'vacancy_blocks_transportCompanyId_fkey'
    ) THEN
        ALTER TABLE "vacancy_blocks"
            ADD CONSTRAINT "vacancy_blocks_transportCompanyId_fkey"
            FOREIGN KEY ("transportCompanyId") REFERENCES "transport_companies"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'block_daily_vacancies_dispatchWeekId_fkey'
    ) THEN
        ALTER TABLE "block_daily_vacancies"
            ADD CONSTRAINT "block_daily_vacancies_dispatchWeekId_fkey"
            FOREIGN KEY ("dispatchWeekId") REFERENCES "dispatch_weeks"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'block_daily_vacancies_vacancyBlockId_fkey'
    ) THEN
        ALTER TABLE "block_daily_vacancies"
            ADD CONSTRAINT "block_daily_vacancies_vacancyBlockId_fkey"
            FOREIGN KEY ("vacancyBlockId") REFERENCES "vacancy_blocks"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
