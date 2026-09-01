-- Drop the old numeric score column (replaced by textual score)
ALTER TABLE "driver_performance_snapshots" DROP COLUMN IF EXISTS "score";

-- Store the original score text from the file
ALTER TABLE "driver_performance_snapshots" ADD COLUMN "scoreText" TEXT;

-- Insucessos now comes pre-calculated from the file as a decimal
ALTER TABLE "driver_performance_snapshots" ALTER COLUMN "insucessos" TYPE DOUBLE PRECISION USING "insucessos"::double precision;

-- New compliance and WHC columns
ALTER TABLE "driver_performance_snapshots" ADD COLUMN "contactCompliance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "driver_performance_snapshots" ADD COLUMN "swipeToFinishCompliance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "driver_performance_snapshots" ADD COLUMN "whc100" BOOLEAN NOT NULL DEFAULT false;

-- Remove defaults so future inserts must provide the values explicitly
ALTER TABLE "driver_performance_snapshots" ALTER COLUMN "contactCompliance" DROP DEFAULT;
ALTER TABLE "driver_performance_snapshots" ALTER COLUMN "swipeToFinishCompliance" DROP DEFAULT;
ALTER TABLE "driver_performance_snapshots" ALTER COLUMN "whc100" DROP DEFAULT;
