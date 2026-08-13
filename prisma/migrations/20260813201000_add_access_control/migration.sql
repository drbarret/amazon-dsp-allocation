-- Add ACCESS_DENIED and ROLE_CHANGED to AuditEventType enum
ALTER TYPE "AuditEventType" ADD VALUE 'ACCESS_DENIED';
ALTER TYPE "AuditEventType" ADD VALUE 'ROLE_CHANGED';

-- Add cpfBlindIndex to driver_profiles
ALTER TABLE "driver_profiles" ADD COLUMN "cpfBlindIndex" TEXT;
CREATE UNIQUE INDEX "driver_profiles_cpfBlindIndex_key" ON "driver_profiles"("cpfBlindIndex");

-- Create allowed_emails table
CREATE TABLE "allowed_emails" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'DRIVER',
    "invitedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allowed_emails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "allowed_emails_email_key" ON "allowed_emails"("email");
CREATE INDEX "allowed_emails_email_idx" ON "allowed_emails"("email");
CREATE INDEX "allowed_emails_status_idx" ON "allowed_emails"("status");

ALTER TABLE "allowed_emails" ADD CONSTRAINT "allowed_emails_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
