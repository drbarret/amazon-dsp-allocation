-- Add VEHICLE_RESTRICTION_UPDATED to AuditEventType enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = '"AuditEventType"'::regtype
    AND enumlabel = 'VEHICLE_RESTRICTION_UPDATED'
  ) THEN
    ALTER TYPE "AuditEventType" ADD VALUE 'VEHICLE_RESTRICTION_UPDATED';
  END IF;
END $$;