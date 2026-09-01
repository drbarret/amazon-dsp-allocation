-- Insucessos is now rounded to an integer during import.
ALTER TABLE "driver_performance_snapshots" ALTER COLUMN "insucessos" TYPE INTEGER USING "insucessos"::integer;
