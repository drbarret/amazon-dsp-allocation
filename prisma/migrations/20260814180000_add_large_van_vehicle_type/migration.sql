-- Add LARGE_VAN to VehicleType enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = '"VehicleType"'::regtype
    AND enumlabel = 'LARGE_VAN'
  ) THEN
    ALTER TYPE "VehicleType" ADD VALUE 'LARGE_VAN';
  END IF;
END $$;
