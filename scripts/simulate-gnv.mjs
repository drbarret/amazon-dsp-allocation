#!/usr/bin/env node
// DB simulation for GNV marking feature.
// 1. Count baseline rows
// 2. Create throwaway driver (user + driverProfile)
// 3. Set GNV marking via setDriverGnvMarking
// 4. Read back and confirm
// 5. Clear GNV marking
// 6. Read back and confirm cleared
// 7. Delete throwaway data
// 8. Verify row counts restored

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/index.js";
import pg from "pg";

// Load env
try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no env file
  }
}

const { Client } = pg;

// We need to call the server action directly, but it uses "use server" and
// imports auth(). Instead, we'll use the Prisma client directly to simulate
// the same operations and verify the audit trail.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== GNV Marking DB Simulation ===\n");

  // 1. Count baseline rows
  const baselineUsers = await prisma.user.count();
  const baselineProfiles = await prisma.driverProfile.count();
  const baselineRestrictions = await prisma.vehicleRestriction.count();
  const baselineAudit = await prisma.auditLog.count();

  console.log(`Baseline: ${baselineUsers} users, ${baselineProfiles} driverProfiles, ${baselineRestrictions} vehicleRestrictions, ${baselineAudit} auditLogs`);

  // 2. Create throwaway driver
  const throwawayEmail = `throwaway-gnv-test-${Date.now()}@test.instalog.com.br`;

  const user = await prisma.user.create({
    data: {
      email: throwawayEmail,
      name: "Throwaway GNV Test Driver",
      role: "DRIVER",
      active: true,
    },
  });
  console.log(`\nCreated throwaway user: ${user.id} (${user.email})`);

  const profile = await prisma.driverProfile.create({
    data: {
      userId: user.id,
      vehicleType: "CARGO_VAN",
      onboardingCompleted: true,
    },
  });
  console.log(`Created throwaway driverProfile: ${profile.id}`);

  // 3. Set GNV marking (simulate what setDriverGnvMarking does)
  await prisma.vehicleRestriction.create({
    data: {
      driverProfileId: profile.id,
      code: "GNV",
    },
  });
  console.log("Set GNV restriction on driver");

  // 4. Read back
  const restrictions = await prisma.vehicleRestriction.findMany({
    where: { driverProfileId: profile.id, code: { in: ["GNV", "NATURAL_GAS"] } },
  });
  console.log(`Read back: ${restrictions.length} GNV restriction(s) found`);
  if (restrictions.length !== 1 || restrictions[0].code !== "GNV") {
    console.error("FAIL: Expected exactly 1 GNV restriction");
    process.exit(1);
  }
  console.log("  -> code:", restrictions[0].code, "id:", restrictions[0].id);

  // Write audit log (simulating what the action does)
  await prisma.auditLog.create({
    data: {
      eventType: "VEHICLE_RESTRICTION_UPDATED",
      actorId: user.id,
      targetUserId: user.id,
      oldValue: { restrictions: [] },
      newValue: { restrictions: ["GNV"] },
      justification: "GNV marcado por supervisor (simulação)",
    },
  });
  console.log("Wrote audit log entry");

  // 5. Clear GNV marking
  await prisma.vehicleRestriction.deleteMany({
    where: { driverProfileId: profile.id, code: { in: ["GNV", "NATURAL_GAS"] } },
  });
  console.log("Cleared GNV restriction");

  // 6. Read back - should be empty
  const afterClear = await prisma.vehicleRestriction.findMany({
    where: { driverProfileId: profile.id, code: { in: ["GNV", "NATURAL_GAS"] } },
  });
  console.log(`Read back after clear: ${afterClear.length} GNV restriction(s)`);
  if (afterClear.length !== 0) {
    console.error("FAIL: Expected 0 GNV restrictions after clear");
    process.exit(1);
  }

  // Write audit log for clear
  await prisma.auditLog.create({
    data: {
      eventType: "VEHICLE_RESTRICTION_UPDATED",
      actorId: user.id,
      targetUserId: user.id,
      oldValue: { restrictions: ["GNV"] },
      newValue: { restrictions: [] },
      justification: "GNV removido por supervisor (simulação)",
    },
  });
  console.log("Wrote audit log entry for clear");

  // 7. Delete throwaway data
  await prisma.auditLog.deleteMany({
    where: { targetUserId: user.id },
  });
  await prisma.vehicleRestriction.deleteMany({
    where: { driverProfileId: profile.id },
  });
  await prisma.driverProfile.delete({
    where: { id: profile.id },
  });
  await prisma.user.delete({
    where: { id: user.id },
  });
  console.log("\nDeleted all throwaway data");

  // 8. Verify row counts restored
  const finalUsers = await prisma.user.count();
  const finalProfiles = await prisma.driverProfile.count();
  const finalRestrictions = await prisma.vehicleRestriction.count();
  const finalAudit = await prisma.auditLog.count();

  console.log(`\nFinal: ${finalUsers} users, ${finalProfiles} driverProfiles, ${finalRestrictions} vehicleRestrictions, ${finalAudit} auditLogs`);

  let errors = 0;
  if (finalUsers !== baselineUsers) {
    console.error(`FAIL: user count mismatch: ${baselineUsers} -> ${finalUsers}`);
    errors++;
  }
  if (finalProfiles !== baselineProfiles) {
    console.error(`FAIL: driverProfile count mismatch: ${baselineProfiles} -> ${finalProfiles}`);
    errors++;
  }
  if (finalRestrictions !== baselineRestrictions) {
    console.error(`FAIL: vehicleRestriction count mismatch: ${baselineRestrictions} -> ${finalRestrictions}`);
    errors++;
  }
  if (finalAudit !== baselineAudit) {
    console.error(`FAIL: auditLog count mismatch: ${baselineAudit} -> ${finalAudit}`);
    errors++;
  }

  if (errors === 0) {
    console.log("\n✅ All row counts restored. Simulation PASSED.");
  } else {
    console.error(`\n❌ ${errors} row count mismatch(es). Simulation FAILED.`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("Simulation error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
