import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import {
  listVacancyBlocks,
  setDailyVacancy,
  saveBlockWeek,
  updateVacancyBlock,
} from "../actions";

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe.skipIf(SKIP_INTEGRATION)("vagas actions integration", () => {
  const runId = Date.now();
  const supervisorEmail = `vacancy-supervisor-${runId}@example.com`;
  const driverEmail = `vacancy-driver-${runId}@example.com`;

  let transportCompanyId = "";
  let otherTransportCompanyId = "";
  let supervisorId = "";
  let driverId = "";
  let weekId = "";
  let dbReady = false;

  // Block IDs created during seed test
  const blockIds: string[] = [];

  function session(role = "SUPERVISOR", companyId?: string | null) {
    return {
      user: {
        id: role === "DRIVER" ? driverId : supervisorId,
        role,
        active: true,
        transportCompanyId: companyId !== undefined ? companyId : transportCompanyId,
      },
    };
  }

  beforeAll(async () => {
    await requireDatabase();
    dbReady = true;

    const company = await prisma.transportCompany.create({
      data: { name: `Vacancy Integration Company ${runId}` },
    });
    transportCompanyId = company.id;

    const otherCompany = await prisma.transportCompany.create({
      data: { name: `Other Vacancy Company ${runId}` },
    });
    otherTransportCompanyId = otherCompany.id;

    const supervisor = await prisma.user.create({
      data: {
        email: supervisorEmail,
        name: "Vacancy Supervisor",
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    });
    supervisorId = supervisor.id;

    const driver = await prisma.user.create({
      data: {
        email: driverEmail,
        name: "Vacancy Driver",
        role: "DRIVER",
        active: true,
        transportCompanyId,
      },
    });
    driverId = driver.id;

    const week = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-VAC-${runId}`,
        year: 2026,
        weekNumber: 35,
        startDate: new Date("2026-08-23"),
        endDate: new Date("2026-08-29"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    weekId = week.id;

    mockAuth.mockResolvedValue(session() as never);
  });

  afterAll(async () => {
    if (!dbReady) return;

    // Clean up daily vacancies for our blocks
    if (blockIds.length > 0) {
      await prisma.blockDailyVacancy.deleteMany({
        where: { vacancyBlockId: { in: blockIds } },
      });
    }

    // Clean up blocks for both companies
    await prisma.vacancyBlock.deleteMany({
      where: { transportCompanyId: { in: [transportCompanyId, otherTransportCompanyId] } },
    });

    // Clean up week
    await prisma.dispatchWeek.deleteMany({ where: { id: weekId } });

    // Clean up users
    await prisma.user.deleteMany({
      where: { id: { in: [supervisorId, driverId] } },
    });

    // Clean up companies
    await prisma.transportCompany.deleteMany({
      where: { id: { in: [transportCompanyId, otherTransportCompanyId] } },
    });
  });

  beforeEach(() => {
    if (supervisorId) {
      mockAuth.mockResolvedValue(session() as never);
    }
  });

  // -------------------------------------------------------------------------
  // Seed idempotente
  // -------------------------------------------------------------------------
  describe("seed idempotente", () => {
    const SEED_BLOCKS = [
      {
        sortOrder: 1,
        name: "Cargo Van (Small) R2.0 - Inside Natural Gas - BR - Ciclo 1",
        eligibleVehicleTypes: ["GNV"],
        cycle: 1,
      },
      {
        sortOrder: 2,
        name: "Cargo Van (Small) R2.0 - BR - Ciclo 1",
        eligibleVehicleTypes: ["CARGO_VAN"],
        cycle: 1,
      },
      {
        sortOrder: 3,
        name: "Standard Parcel - Small Van - BR - Ciclo 2",
        eligibleVehicleTypes: ["CARGO_VAN", "GNV"],
        cycle: 2,
      },
      {
        sortOrder: 4,
        name: "Same Day Passenger Car - Ciclo 2",
        eligibleVehicleTypes: ["PASSENGER"],
        cycle: 2,
      },
    ];

    async function seedBlocks(companyId: string) {
      for (const block of SEED_BLOCKS) {
        const existing = await prisma.vacancyBlock.findFirst({
          where: { name: block.name, transportCompanyId: companyId },
        });
        if (!existing) {
          await prisma.vacancyBlock.create({
            data: {
              transportCompanyId: companyId,
              name: block.name,
              cycle: block.cycle,
              eligibleVehicleTypes: block.eligibleVehicleTypes as never,
              sortOrder: block.sortOrder,
              active: true,
            },
          });
        }
      }
    }

    it("creates 4 blocks on first run", async () => {
      await seedBlocks(transportCompanyId);

      const blocks = await prisma.vacancyBlock.findMany({
        where: { transportCompanyId },
      });
      expect(blocks).toHaveLength(4);

      // Store IDs for later tests
      blockIds.push(...blocks.map((b) => b.id));

      // Verify eligibility and cycle
      const gnvBlock = blocks.find((b) => b.sortOrder === 1);
      expect(gnvBlock?.eligibleVehicleTypes).toEqual(["GNV"]);
      expect(gnvBlock?.cycle).toBe(1);

      const cargoBlock = blocks.find((b) => b.sortOrder === 2);
      expect(cargoBlock?.eligibleVehicleTypes).toEqual(["CARGO_VAN"]);
      expect(cargoBlock?.cycle).toBe(1);

      const mixedBlock = blocks.find((b) => b.sortOrder === 3);
      expect(mixedBlock?.eligibleVehicleTypes).toEqual(expect.arrayContaining(["CARGO_VAN", "GNV"]));
      expect(mixedBlock?.cycle).toBe(2);

      const passengerBlock = blocks.find((b) => b.sortOrder === 4);
      expect(passengerBlock?.eligibleVehicleTypes).toEqual(["PASSENGER"]);
      expect(passengerBlock?.cycle).toBe(2);
    });

    it("does not duplicate blocks on second run (idempotent)", async () => {
      await seedBlocks(transportCompanyId);

      const blocks = await prisma.vacancyBlock.findMany({
        where: { transportCompanyId },
      });
      expect(blocks).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // listVacancyBlocks
  // -------------------------------------------------------------------------
  describe("listVacancyBlocks", () => {
    it("lists blocks with daily vacancies and totals", async () => {
      const result = await listVacancyBlocks(weekId);

      expect(result.success).toBe(true);
      expect(result.blocks).toHaveLength(4);
      expect(result.blocks[0].name).toContain("Inside Natural Gas");
      expect(result.blocks[0].total).toBe(0); // no vacancies yet
    });

    it("rejects week from another company", async () => {
      const otherWeek = await prisma.dispatchWeek.create({
        data: {
          transportCompanyId: otherTransportCompanyId,
          weekKey: `WK-OTHER-VAC-${runId}`,
          year: 2026,
          weekNumber: 1,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-01-07"),
          status: "PLANNING",
        },
      });

      const result = await listVacancyBlocks(otherWeek.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/não pertence/);

      await prisma.dispatchWeek.delete({ where: { id: otherWeek.id } });
    });
  });

  // -------------------------------------------------------------------------
  // setDailyVacancy
  // -------------------------------------------------------------------------
  describe("setDailyVacancy", () => {
    it("creates a daily vacancy cell", async () => {
      const blockId = blockIds[0];
      const result = await setDailyVacancy(blockId, weekId, 1, 5); // Monday = 5

      expect(result.success).toBe(true);

      const vacancy = await prisma.blockDailyVacancy.findUnique({
        where: {
          dispatchWeekId_vacancyBlockId_dayOfWeek: {
            dispatchWeekId: weekId,
            vacancyBlockId: blockId,
            dayOfWeek: 1,
          },
        },
      });
      expect(vacancy).not.toBeNull();
      expect(vacancy?.count).toBe(5);
    });

    it("updates an existing daily vacancy cell (upsert)", async () => {
      const blockId = blockIds[0];
      const result = await setDailyVacancy(blockId, weekId, 1, 10);

      expect(result.success).toBe(true);

      const vacancy = await prisma.blockDailyVacancy.findUnique({
        where: {
          dispatchWeekId_vacancyBlockId_dayOfWeek: {
            dispatchWeekId: weekId,
            vacancyBlockId: blockId,
            dayOfWeek: 1,
          },
        },
      });
      expect(vacancy?.count).toBe(10);
    });

    it("rejects negative count", async () => {
      const blockId = blockIds[0];
      const result = await setDailyVacancy(blockId, weekId, 2, -1);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/inteiro >= 0/);
    });

    it("rejects non-integer count", async () => {
      const blockId = blockIds[0];
      const result = await setDailyVacancy(blockId, weekId, 2, 3.5);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/inteiro >= 0/);
    });

    it("rejects invalid dayOfWeek", async () => {
      const blockId = blockIds[0];
      const result = await setDailyVacancy(blockId, weekId, 7, 5);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/dayOfWeek deve estar entre 0 e 6/);
    });

    it("rejects block from another company (cross-company isolation)", async () => {
      // Create a block in the other company
      const otherBlock = await prisma.vacancyBlock.create({
        data: {
          transportCompanyId: otherTransportCompanyId,
          name: "Other Company Block",
          cycle: 1,
          eligibleVehicleTypes: ["GNV"],
          sortOrder: 1,
        },
      });

      const result = await setDailyVacancy(otherBlock.id, weekId, 0, 5);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/não pertence/);

      await prisma.vacancyBlock.delete({ where: { id: otherBlock.id } });
    });
  });

  // -------------------------------------------------------------------------
  // saveBlockWeek
  // -------------------------------------------------------------------------
  describe("saveBlockWeek", () => {
    it("saves all 7 daily values and total matches", async () => {
      const blockId = blockIds[1];
      const counts = [1, 2, 3, 4, 5, 6, 7]; // Dom=1, Seg=2, ..., Sáb=7

      const result = await saveBlockWeek(blockId, weekId, counts);
      expect(result.success).toBe(true);

      const vacancies = await prisma.blockDailyVacancy.findMany({
        where: { vacancyBlockId: blockId, dispatchWeekId: weekId },
        orderBy: { dayOfWeek: "asc" },
      });
      expect(vacancies).toHaveLength(7);

      const total = vacancies.reduce((sum, v) => sum + v.count, 0);
      expect(total).toBe(28); // 1+2+3+4+5+6+7

      // Verify each day
      for (let i = 0; i < 7; i++) {
        expect(vacancies[i].count).toBe(counts[i]);
      }
    });

    it("rejects counts with wrong length", async () => {
      const blockId = blockIds[1];
      const result = await saveBlockWeek(blockId, weekId, [1, 2, 3]);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/7 posições/);
    });

    it("rejects counts with negative values", async () => {
      const blockId = blockIds[1];
      const result = await saveBlockWeek(blockId, weekId, [1, 2, -1, 4, 5, 6, 7]);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/inteiro >= 0/);
    });
  });

  // -------------------------------------------------------------------------
  // updateVacancyBlock
  // -------------------------------------------------------------------------
  describe("updateVacancyBlock", () => {
    it("updates eligibility and persists", async () => {
      const blockId = blockIds[2]; // Standard Parcel - Ciclo 2

      const result = await updateVacancyBlock(blockId, {
        eligibleVehicleTypes: ["GNV"],
      });
      expect(result.success).toBe(true);

      const updated = await prisma.vacancyBlock.findUnique({
        where: { id: blockId },
      });
      expect(updated?.eligibleVehicleTypes).toEqual(["GNV"]);
    });

    it("updates name and cycle", async () => {
      const blockId = blockIds[2];

      const result = await updateVacancyBlock(blockId, {
        name: "Updated Block Name",
        cycle: 1,
      });
      expect(result.success).toBe(true);

      const updated = await prisma.vacancyBlock.findUnique({
        where: { id: blockId },
      });
      expect(updated?.name).toBe("Updated Block Name");
      expect(updated?.cycle).toBe(1);
    });

    it("rejects empty eligibleVehicleTypes", async () => {
      const blockId = blockIds[2];

      const result = await updateVacancyBlock(blockId, {
        eligibleVehicleTypes: [],
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/não pode ser vazio/);
    });

    it("rejects invalid cycle", async () => {
      const blockId = blockIds[2];

      const result = await updateVacancyBlock(blockId, {
        cycle: 3,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cycle deve ser 1 ou 2/);
    });

    it("rejects block from another company", async () => {
      const otherBlock = await prisma.vacancyBlock.create({
        data: {
          transportCompanyId: otherTransportCompanyId,
          name: "Other Block for Update Test",
          cycle: 1,
          eligibleVehicleTypes: ["GNV"],
          sortOrder: 1,
        },
      });

      const result = await updateVacancyBlock(otherBlock.id, { name: "Hacked" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/não pertence/);

      await prisma.vacancyBlock.delete({ where: { id: otherBlock.id } });
    });
  });

  // -------------------------------------------------------------------------
  // Permission: DRIVER denied
  // -------------------------------------------------------------------------
  describe("permission", () => {
    it("DRIVER is denied access to listVacancyBlocks", async () => {
      mockAuth.mockResolvedValue(session("DRIVER") as never);

      await expect(listVacancyBlocks(weekId)).rejects.toThrow("NEXT_REDIRECT");
    });

    it("DRIVER is denied access to setDailyVacancy", async () => {
      mockAuth.mockResolvedValue(session("DRIVER") as never);

      await expect(setDailyVacancy(blockIds[0], weekId, 0, 5)).rejects.toThrow("NEXT_REDIRECT");
    });

    it("DRIVER is denied access to saveBlockWeek", async () => {
      mockAuth.mockResolvedValue(session("DRIVER") as never);

      await expect(saveBlockWeek(blockIds[0], weekId, [0, 0, 0, 0, 0, 0, 0])).rejects.toThrow(
        "NEXT_REDIRECT"
      );
    });

    it("DRIVER is denied access to updateVacancyBlock", async () => {
      mockAuth.mockResolvedValue(session("DRIVER") as never);

      await expect(updateVacancyBlock(blockIds[0], { name: "Hacked" })).rejects.toThrow(
        "NEXT_REDIRECT"
      );
    });
  });
});
