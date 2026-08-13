-- AlterTable
ALTER TABLE "users" ALTER COLUMN "emailVerified" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "emailVerified" DROP DEFAULT;
