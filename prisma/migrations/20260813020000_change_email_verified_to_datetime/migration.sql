-- AlterTable: change emailVerified from BOOLEAN to TIMESTAMP
ALTER TABLE "users" ALTER COLUMN "emailVerified" TYPE TIMESTAMP(3) USING NULL;
