-- AlterTable: add driver edit fields to DriverProfile
ALTER TABLE "driver_profiles" ADD COLUMN "worksCiclo1" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "driver_profiles" ADD COLUMN "worksCiclo2" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "driver_profiles" ADD COLUMN "isTrusted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "driver_profiles" ADD COLUMN "whatsappGroup" TEXT;

-- CreateEnum
CREATE TYPE "DeactivationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum: add new audit event types
ALTER TYPE "AuditEventType" ADD VALUE 'DRIVER_PROFILE_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRIVER_PHONE_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'DEACTIVATION_REQUEST_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'DEACTIVATION_REQUEST_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE 'DEACTIVATION_REQUEST_REJECTED';
ALTER TYPE "AuditEventType" ADD VALUE 'DEACTIVATION_REQUEST_CANCELLED';

-- CreateTable
CREATE TABLE "deactivation_requests" (
    "id" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "DeactivationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deactivation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deactivation_requests_status_idx" ON "deactivation_requests"("status");
CREATE INDEX "deactivation_requests_driverUserId_idx" ON "deactivation_requests"("driverUserId");

-- Partial unique index: only one PENDING deactivation request per driver
CREATE UNIQUE INDEX "deactivation_requests_one_pending_per_driver"
  ON "deactivation_requests" ("driverUserId")
  WHERE status = 'PENDING';

-- AddForeignKey
ALTER TABLE "deactivation_requests" ADD CONSTRAINT "deactivation_requests_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deactivation_requests" ADD CONSTRAINT "deactivation_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deactivation_requests" ADD CONSTRAINT "deactivation_requests_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
