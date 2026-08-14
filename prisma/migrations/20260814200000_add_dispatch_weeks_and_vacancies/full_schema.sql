◇ injected env (11) from .env.local // tip: ⌘ enable debugging { debug: true }
◇ injected env (0) from .env // tip: ⌁ auth for agents [www.vestauth.com]
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DRIVER', 'SUPERVISOR', 'ACCOUNT_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "WeekDay" AS ENUM ('DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO');

-- CreateEnum
CREATE TYPE "Cycle" AS ENUM ('CICLO_1', 'CICLO_2');

-- CreateEnum
CREATE TYPE "AvailabilityAnswer" AS ENUM ('SIM', 'NAO', 'CICLO_2');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CARGO_VAN', 'LARGE_VAN', 'PASSEIO');

-- CreateEnum
CREATE TYPE "VehicleRestrictionCode" AS ENUM ('GNV', 'REFRIGERADOR', 'CAPACIDADE_REDUZIDA', 'NATURAL_GAS');

-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('RASCUNHO', 'PUBLICADA', 'FECHADA');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('SIM', 'SEM_ESCALA', 'A_CONFIRMAR', 'NAO', 'SPEED', 'FALTA');

-- CreateEnum
CREATE TYPE "ScorecardClassification" AS ENUM ('FANTASTIC_PLUS', 'FANTASTIC', 'GREAT', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "BehaviorType" AS ENUM ('ADVERTENCIA', 'SUSPENSAO_ALOCACAO', 'PENALIDADE_PONTUACAO', 'EXCECAO');

-- CreateEnum
CREATE TYPE "DispatchWeekStatus" AS ENUM ('PLANNING', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('PENDING', 'SCHEDULED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('LOGIN', 'LOGOUT', 'ACCESS_DENIED', 'ROLE_CHANGED', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'USER_INVITED', 'USER_INVITE_REVOKED', 'AVAILABILITY_SUBMITTED', 'AVAILABILITY_UPDATED', 'VACANCY_PUBLISHED', 'VACANCY_UPDATED', 'ALLOCATION_RUN', 'SCHEDULE_CREATED', 'SCHEDULE_UPDATED', 'SCHEDULE_PUBLISHED', 'WHATSAPP_SENT', 'SCORECARD_IMPORTED', 'BEHAVIOR_RECORD_CREATED', 'BEHAVIOR_RECORD_UPDATED', 'MANUAL_OVERRIDE', 'CONSENT_GIVEN', 'CONSENT_REVOKED', 'VEHICLE_RESTRICTION_UPDATED');

-- CreateTable
CREATE TABLE "transport_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "cnpj" TEXT,
    "amazonDspId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" TEXT NOT NULL,
    "transportCompanyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "transportCompanyId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'DRIVER',
    "amazonSub" TEXT,
    "amazonAccessToken" TEXT,
    "amazonRefreshToken" TEXT,
    "amazonTokenExpiresAt" TIMESTAMP(3),
    "emailVerified" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cpf" TEXT,
    "cpfBlindIndex" TEXT,
    "phone" TEXT,
    "phoneFormatted" TEXT,
    "vehicleType" "VehicleType" NOT NULL DEFAULT 'CARGO_VAN',
    "transporterId" TEXT,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "behaviorApprovedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_restrictions" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "code" "VehicleRestrictionCode" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "region_city_preferences" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT,
    "regionId" TEXT,
    "city" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "region_city_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_weeks" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "extendedUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_availabilities" (
    "id" TEXT NOT NULL,
    "availabilityWeekId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" "WeekDay" NOT NULL,
    "cycle" "Cycle" NOT NULL DEFAULT 'CICLO_1',
    "answer" "AvailabilityAnswer" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancy_programs" (
    "id" TEXT NOT NULL,
    "transportCompanyId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "day" "WeekDay" NOT NULL,
    "cycle" "Cycle" NOT NULL DEFAULT 'CICLO_1',
    "vehicleCategory" TEXT NOT NULL,
    "vehicleType" "VehicleType",
    "quantity" INTEGER NOT NULL,
    "status" "VacancyStatus" NOT NULL DEFAULT 'RASCUNHO',
    "source" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancy_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_runs" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "regionId" TEXT,
    "triggeredById" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "configSnapshot" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_results" (
    "id" TEXT NOT NULL,
    "allocationRunId" TEXT NOT NULL,
    "vacancyProgramId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "day" "WeekDay" NOT NULL,
    "cycle" "Cycle" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchedVehicleType" BOOLEAN NOT NULL DEFAULT false,
    "matchedRegionPref" BOOLEAN NOT NULL DEFAULT false,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "behaviorPenalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consecutiveDaysBefore" INTEGER,
    "assigned" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "allocationRunId" TEXT,
    "userId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "day" "WeekDay" NOT NULL,
    "cycle" "Cycle" NOT NULL DEFAULT 'CICLO_1',
    "status" "ScheduleStatus" NOT NULL,
    "vehicleCategory" TEXT,
    "overrideById" TEXT,
    "overrideReason" TEXT,
    "overrideAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorecard_imports" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "importedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "errors" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scorecard_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_scores" (
    "id" TEXT NOT NULL,
    "scorecardImportId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "daRank" INTEGER,
    "transporterId" TEXT,
    "totalScore" DOUBLE PRECISION,
    "delivered" INTEGER,
    "dcr" DOUBLE PRECISION,
    "dnrDpmo" DOUBLE PRECISION,
    "contactCompliance" DOUBLE PRECISION,
    "scanCompliance" DOUBLE PRECISION,
    "whExceptionFlag" BOOLEAN,
    "swaOta" DOUBLE PRECISION,
    "swipeToFinishCompliance" DOUBLE PRECISION,
    "workHourCompliance" DOUBLE PRECISION,
    "attrition" DOUBLE PRECISION,
    "dspLateCancellationRate" DOUBLE PRECISION,
    "classification" "ScorecardClassification",
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_drivers" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "manualOverrideById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "favorite_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavior_records" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "type" "BehaviorType" NOT NULL,
    "description" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "weekKey" TEXT NOT NULL,
    "effectiveFromWeek" TEXT NOT NULL,
    "effectiveToWeek" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "impactScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "markedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "resetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behavior_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_weeks" (
    "id" TEXT NOT NULL,
    "transportCompanyId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "DispatchWeekStatus" NOT NULL DEFAULT 'PLANNING',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancies" (
    "id" TEXT NOT NULL,
    "dispatchWeekId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "shiftBlock" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_assignments" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "weekKey" TEXT,
    "templateName" TEXT,
    "body" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "externalMessageId" TEXT,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'PENDING',
    "statusHistory" JSONB,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "eventType" "AuditEventType" NOT NULL,
    "actorId" TEXT,
    "targetUserId" TEXT,
    "scheduleId" TEXT,
    "allocationRunId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "justification" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "transport_companies_cnpj_key" ON "transport_companies"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "transport_companies_amazonDspId_key" ON "transport_companies"("amazonDspId");

-- CreateIndex
CREATE UNIQUE INDEX "regions_transportCompanyId_code_key" ON "regions"("transportCompanyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_amazonSub_key" ON "users"("amazonSub");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_active_idx" ON "users"("role", "active");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_userId_key" ON "driver_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_cpf_key" ON "driver_profiles"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_cpfBlindIndex_key" ON "driver_profiles"("cpfBlindIndex");

-- CreateIndex
CREATE INDEX "driver_profiles_transporterId_idx" ON "driver_profiles"("transporterId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_restrictions_driverProfileId_code_key" ON "vehicle_restrictions"("driverProfileId", "code");

-- CreateIndex
CREATE INDEX "region_city_preferences_driverProfileId_idx" ON "region_city_preferences"("driverProfileId");

-- CreateIndex
CREATE INDEX "region_city_preferences_regionId_idx" ON "region_city_preferences"("regionId");

-- CreateIndex
CREATE INDEX "availability_weeks_weekKey_idx" ON "availability_weeks"("weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "availability_weeks_year_weekNumber_key" ON "availability_weeks"("year", "weekNumber");

-- CreateIndex
CREATE INDEX "weekly_availabilities_availabilityWeekId_userId_idx" ON "weekly_availabilities"("availabilityWeekId", "userId");

-- CreateIndex
CREATE INDEX "weekly_availabilities_userId_availabilityWeekId_idx" ON "weekly_availabilities"("userId", "availabilityWeekId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_availabilities_availabilityWeekId_userId_day_cycle_key" ON "weekly_availabilities"("availabilityWeekId", "userId", "day", "cycle");

-- CreateIndex
CREATE INDEX "vacancy_programs_weekKey_regionId_idx" ON "vacancy_programs"("weekKey", "regionId");

-- CreateIndex
CREATE INDEX "vacancy_programs_regionId_year_weekNumber_idx" ON "vacancy_programs"("regionId", "year", "weekNumber");

-- CreateIndex
CREATE INDEX "vacancy_programs_status_idx" ON "vacancy_programs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_programs_regionId_year_weekNumber_day_cycle_vehicle_key" ON "vacancy_programs"("regionId", "year", "weekNumber", "day", "cycle", "vehicleCategory");

-- CreateIndex
CREATE INDEX "allocation_runs_weekKey_regionId_idx" ON "allocation_runs"("weekKey", "regionId");

-- CreateIndex
CREATE INDEX "allocation_runs_status_idx" ON "allocation_runs"("status");

-- CreateIndex
CREATE INDEX "distribution_results_allocationRunId_driverProfileId_idx" ON "distribution_results"("allocationRunId", "driverProfileId");

-- CreateIndex
CREATE INDEX "distribution_results_allocationRunId_vacancyProgramId_idx" ON "distribution_results"("allocationRunId", "vacancyProgramId");

-- CreateIndex
CREATE INDEX "schedules_weekKey_regionId_idx" ON "schedules"("weekKey", "regionId");

-- CreateIndex
CREATE INDEX "schedules_userId_year_weekNumber_idx" ON "schedules"("userId", "year", "weekNumber");

-- CreateIndex
CREATE INDEX "schedules_status_isLocked_idx" ON "schedules"("status", "isLocked");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_userId_year_weekNumber_day_cycle_regionId_key" ON "schedules"("userId", "year", "weekNumber", "day", "cycle", "regionId");

-- CreateIndex
CREATE INDEX "scorecard_imports_weekKey_idx" ON "scorecard_imports"("weekKey");

-- CreateIndex
CREATE INDEX "scorecard_imports_status_idx" ON "scorecard_imports"("status");

-- CreateIndex
CREATE INDEX "driver_scores_driverProfileId_scorecardImportId_idx" ON "driver_scores"("driverProfileId", "scorecardImportId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_scores_scorecardImportId_driverProfileId_key" ON "driver_scores"("scorecardImportId", "driverProfileId");

-- CreateIndex
CREATE INDEX "favorite_drivers_weekKey_idx" ON "favorite_drivers"("weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_drivers_driverProfileId_year_weekNumber_key" ON "favorite_drivers"("driverProfileId", "year", "weekNumber");

-- CreateIndex
CREATE INDEX "behavior_records_driverProfileId_effectiveFromWeek_idx" ON "behavior_records"("driverProfileId", "effectiveFromWeek");

-- CreateIndex
CREATE INDEX "behavior_records_type_effectiveFromWeek_idx" ON "behavior_records"("type", "effectiveFromWeek");

-- CreateIndex
CREATE INDEX "behavior_records_status_idx" ON "behavior_records"("status");

-- CreateIndex
CREATE INDEX "dispatch_weeks_weekKey_idx" ON "dispatch_weeks"("weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_weeks_transportCompanyId_year_weekNumber_key" ON "dispatch_weeks"("transportCompanyId", "year", "weekNumber");

-- CreateIndex
CREATE INDEX "vacancies_dispatchWeekId_date_idx" ON "vacancies"("dispatchWeekId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "vacancies_dispatchWeekId_date_vehicleType_shiftBlock_key" ON "vacancies"("dispatchWeekId", "date", "vehicleType", "shiftBlock");

-- CreateIndex
CREATE INDEX "dispatch_assignments_driverProfileId_idx" ON "dispatch_assignments"("driverProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_assignments_vacancyId_driverProfileId_key" ON "dispatch_assignments"("vacancyId", "driverProfileId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_userId_weekKey_idx" ON "whatsapp_messages"("userId", "weekKey");

-- CreateIndex
CREATE INDEX "whatsapp_messages_externalMessageId_idx" ON "whatsapp_messages"("externalMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_status_idx" ON "whatsapp_messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "audit_logs_eventType_createdAt_idx" ON "audit_logs"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_scheduleId_idx" ON "audit_logs"("scheduleId");

-- CreateIndex
CREATE INDEX "audit_logs_targetUserId_idx" ON "audit_logs"("targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "allowed_emails_email_key" ON "allowed_emails"("email");

-- CreateIndex
CREATE INDEX "allowed_emails_email_idx" ON "allowed_emails"("email");

-- CreateIndex
CREATE INDEX "allowed_emails_status_idx" ON "allowed_emails"("status");

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_transportCompanyId_fkey" FOREIGN KEY ("transportCompanyId") REFERENCES "transport_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_transportCompanyId_fkey" FOREIGN KEY ("transportCompanyId") REFERENCES "transport_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_restrictions" ADD CONSTRAINT "vehicle_restrictions_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "region_city_preferences" ADD CONSTRAINT "region_city_preferences_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "region_city_preferences" ADD CONSTRAINT "region_city_preferences_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_availabilities" ADD CONSTRAINT "weekly_availabilities_availabilityWeekId_fkey" FOREIGN KEY ("availabilityWeekId") REFERENCES "availability_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_availabilities" ADD CONSTRAINT "weekly_availabilities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_programs" ADD CONSTRAINT "vacancy_programs_transportCompanyId_fkey" FOREIGN KEY ("transportCompanyId") REFERENCES "transport_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_programs" ADD CONSTRAINT "vacancy_programs_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_results" ADD CONSTRAINT "distribution_results_allocationRunId_fkey" FOREIGN KEY ("allocationRunId") REFERENCES "allocation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_results" ADD CONSTRAINT "distribution_results_vacancyProgramId_fkey" FOREIGN KEY ("vacancyProgramId") REFERENCES "vacancy_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_allocationRunId_fkey" FOREIGN KEY ("allocationRunId") REFERENCES "allocation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_scorecardImportId_fkey" FOREIGN KEY ("scorecardImportId") REFERENCES "scorecard_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_drivers" ADD CONSTRAINT "favorite_drivers_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_drivers" ADD CONSTRAINT "favorite_drivers_manualOverrideById_fkey" FOREIGN KEY ("manualOverrideById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_records" ADD CONSTRAINT "behavior_records_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_records" ADD CONSTRAINT "behavior_records_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_records" ADD CONSTRAINT "behavior_records_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_weeks" ADD CONSTRAINT "dispatch_weeks_transportCompanyId_fkey" FOREIGN KEY ("transportCompanyId") REFERENCES "transport_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_dispatchWeekId_fkey" FOREIGN KEY ("dispatchWeekId") REFERENCES "dispatch_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_assignments" ADD CONSTRAINT "dispatch_assignments_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_assignments" ADD CONSTRAINT "dispatch_assignments_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_assignments" ADD CONSTRAINT "dispatch_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_emails" ADD CONSTRAINT "allowed_emails_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

