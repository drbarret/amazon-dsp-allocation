-- CreateTable
CREATE TABLE "performance_imports" (
    "id" TEXT NOT NULL,
    "dispatchWeekId" TEXT,
    "weekKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "transportCompanyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_performance_snapshots" (
    "id" TEXT NOT NULL,
    "performanceImportId" TEXT NOT NULL,
    "driverProfileId" TEXT,
    "transporterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "deliveredPackages" INTEGER NOT NULL,
    "dcr" DOUBLE PRECISION NOT NULL,
    "dnr" INTEGER NOT NULL,
    "insucessos" INTEGER NOT NULL,
    "classification" "ScorecardClassification" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_performance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "performance_imports_dispatchWeekId_idx" ON "performance_imports"("dispatchWeekId");

-- CreateIndex
CREATE INDEX "performance_imports_weekKey_idx" ON "performance_imports"("weekKey");

-- CreateIndex
CREATE INDEX "performance_imports_status_idx" ON "performance_imports"("status");

-- CreateIndex
CREATE INDEX "performance_imports_transportCompanyId_idx" ON "performance_imports"("transportCompanyId");

-- CreateIndex
CREATE INDEX "driver_performance_snapshots_performanceImportId_idx" ON "driver_performance_snapshots"("performanceImportId");

-- CreateIndex
CREATE INDEX "driver_performance_snapshots_driverProfileId_idx" ON "driver_performance_snapshots"("driverProfileId");

-- CreateIndex
CREATE INDEX "driver_performance_snapshots_transporterId_idx" ON "driver_performance_snapshots"("transporterId");

-- AddForeignKey
ALTER TABLE "performance_imports" ADD CONSTRAINT "performance_imports_dispatchWeekId_fkey" FOREIGN KEY ("dispatchWeekId") REFERENCES "dispatch_weeks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_imports" ADD CONSTRAINT "performance_imports_transportCompanyId_fkey" FOREIGN KEY ("transportCompanyId") REFERENCES "transport_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_performance_snapshots" ADD CONSTRAINT "driver_performance_snapshots_performanceImportId_fkey" FOREIGN KEY ("performanceImportId") REFERENCES "performance_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_performance_snapshots" ADD CONSTRAINT "driver_performance_snapshots_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
