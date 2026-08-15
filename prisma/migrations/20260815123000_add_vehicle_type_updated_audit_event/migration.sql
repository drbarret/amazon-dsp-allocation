-- Migration: audit event for supervisor vehicle-type edits
--
-- Context:
--   - Supervisors can now edit a driver's vehicle category (CARGO_VAN,
--     LARGE_VAN, PASSEIO) from the /admin/users screen, mirroring the
--     existing CNH and city-preference edits. Each edit is audited, so a
--     new AuditEventType value is added: VEHICLE_TYPE_UPDATED.

-- 1. New audit event type
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VEHICLE_TYPE_UPDATED';
