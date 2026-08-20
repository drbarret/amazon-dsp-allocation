import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { SKIP_INTEGRATION, requireDatabase } from "@/lib/test-db-gate";
import { importAvailability, listAvailabilities, approveAvailability, rejectAvailability, updateAvailability, clearWeek } from "../actions";

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

describe.skipIf(SKIP_INTEGRATION)("importAvailability integration", () => {
  const runId = Date.now();
  const supervisorEmail = `integration-supervisor-${runId}@example.com`;
  const activeDriverEmail = `integration-active-${runId}@example.com`;
  const inactiveDriverEmail = `integration-inactive-${runId}@example.com`;
  const unknownDriverEmail = `integration-unknown-${runId}@example.com`;

  let transportCompanyId = "";
  let supervisorId = "";
  let activeDriverId = "";
  let inactiveDriverId = "";
  let weekId = "";
  let dbReady = false;
  const bulkDriverIds: string[] = [];

  function session() {
    return {
      user: {
        id: supervisorId,
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    };
  }

  function buildXlsx(rows: unknown[][]): Buffer {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }

  const HEADERS = [
    "Carimbo de data/hora",
    "Endereço de e-mail",
    "Nome completo",
    "CPF",
    "GNV?",
    "Passeio?",
    "Dom",
    "Seg",
    "Ter",
    "Qua",
    "Qui",
    "Sex",
    "Sáb",
    "Speed?",
  ];

  function dataRow(overrides: Partial<Record<number, string>> = {}): unknown[] {
    const base: unknown[] = [
      "18/08/2026 14:30:00",
      activeDriverEmail,
      "Motorista Ativo",
      "123.456.789-09",
      "Sim",
      "Não",
      "Sim",
      "Sim",
      "Sim",
      "Sim",
      "Sim",
      "Sim",
      "Não",
      "Sim",
    ];
    Object.entries(overrides).forEach(([idx, value]) => {
      base[Number(idx)] = value;
    });
    return base;
  }

  beforeAll(async () => {
    await requireDatabase();
    dbReady = true;

    const company = await prisma.transportCompany.create({
      data: { name: `Integration Company ${runId}` },
    });
    transportCompanyId = company.id;

    const supervisor = await prisma.user.create({
      data: {
        email: supervisorEmail,
        name: "Integration Supervisor",
        role: "SUPERVISOR",
        active: true,
        transportCompanyId,
      },
    });
    supervisorId = supervisor.id;

    const activeDriver = await prisma.user.create({
      data: {
        email: activeDriverEmail,
        name: "Active Driver",
        role: "DRIVER",
        active: true,
        transportCompanyId,
      },
    });
    activeDriverId = activeDriver.id;

    const inactiveDriver = await prisma.user.create({
      data: {
        email: inactiveDriverEmail,
        name: "Inactive Driver",
        role: "DRIVER",
        active: false,
        transportCompanyId,
      },
    });
    inactiveDriverId = inactiveDriver.id;

    const week = await prisma.dispatchWeek.create({
      data: {
        transportCompanyId,
        weekKey: `WK-${runId}`,
        year: 2026,
        weekNumber: 35,
        startDate: new Date("2026-08-30"),
        endDate: new Date("2026-09-05"),
        status: "PLANNING",
        createdById: supervisorId,
      },
    });
    weekId = week.id;

    mockAuth.mockResolvedValue(session() as never);
  });

  afterAll(async () => {
    if (!dbReady) return;

    await prisma.availabilityApproval.deleteMany({
      where: { driverAvailability: { dispatchWeekId: weekId } },
    });
    await prisma.driverAvailability.deleteMany({ where: { dispatchWeekId: weekId } });
    await prisma.dispatchWeek.deleteMany({ where: { id: weekId } });
    await prisma.user.deleteMany({
      where: { id: { in: [supervisorId, activeDriverId, inactiveDriverId, ...bulkDriverIds] } },
    });
    await prisma.transportCompany.deleteMany({ where: { id: transportCompanyId } });

    // Clean up any other weeks/companies created by isolation tests.
    const otherWeeks = await prisma.dispatchWeek.findMany({
      where: { weekKey: { startsWith: `WK-OTHER` } },
      select: { id: true },
    });
    const otherWeekIds = otherWeeks.map((w) => w.id);
    if (otherWeekIds.length > 0) {
      await prisma.availabilityApproval.deleteMany({
        where: { driverAvailability: { dispatchWeekId: { in: otherWeekIds } } },
      });
      await prisma.driverAvailability.deleteMany({ where: { dispatchWeekId: { in: otherWeekIds } } });
      await prisma.dispatchWeek.deleteMany({ where: { id: { in: otherWeekIds } } });
    }
    await prisma.transportCompany.deleteMany({
      where: { name: { startsWith: "Other" } },
    });
  });

  beforeEach(() => {
    if (supervisorId) {
      mockAuth.mockResolvedValue(session() as never);
    }
  });

  function buildFormData(week: string, xlsxBuffer: Buffer): FormData {
    const formData = new FormData();
    formData.append("week", week);
    formData.append(
      "file",
      new File([new Uint8Array(xlsxBuffer)], "DA_Disponibilidade.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
    return formData;
  }

  it("imports active driver availability and persists DriverAvailability", async () => {
    const file = buildXlsx([HEADERS, dataRow()]);
    const result = await importAvailability(buildFormData(`W${runId}`, file));

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.pendingApproval).toBe(0);
    expect(result.errors).toHaveLength(0);

    const availability = await prisma.driverAvailability.findFirst({
      where: { dispatchWeekId: weekId, userId: activeDriverId },
    });
    expect(availability).not.toBeNull();
    expect(availability?.hasNaturalGas).toBe(true);
    expect(availability?.speedAfternoon).toBe(true);
  });

  it("imports inactive driver availability and creates AvailabilityApproval PENDING", async () => {
    const file = buildXlsx([
      HEADERS,
      dataRow({ 1: inactiveDriverEmail, 2: "Inactive Driver" }),
    ]);
    const result = await importAvailability(buildFormData(`W${runId}`, file));

    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.pendingApproval).toBe(1);
    expect(result.errors).toHaveLength(0);

    const availability = await prisma.driverAvailability.findFirst({
      where: { dispatchWeekId: weekId, userId: inactiveDriverId },
    });
    expect(availability).not.toBeNull();

    const approval = await prisma.availabilityApproval.findUnique({
      where: { driverAvailabilityId: availability!.id },
    });
    expect(approval).not.toBeNull();
    expect(approval?.status).toBe("PENDING");
  });

  it("upserts availability when re-importing the same week", async () => {
    const file = buildXlsx([
      HEADERS,
      dataRow({ 12: "Sim" }), // change satAvailable to true
    ]);
    const result = await importAvailability(buildFormData(`W${runId}`, file));

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);

    const availability = await prisma.driverAvailability.findFirst({
      where: { dispatchWeekId: weekId, userId: activeDriverId },
    });
    expect(availability?.satAvailable).toBe(true);
  });

  it("returns error when dispatch week does not exist", async () => {
    const file = buildXlsx([HEADERS, dataRow()]);
    const result = await importAvailability(buildFormData("W999999", file));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Semana não encontrada/);
    expect(result.imported).toBe(0);
  });

  it("rejects DRIVER with permission error", async () => {
    mockAuth.mockResolvedValue({
      user: { id: activeDriverId, role: "DRIVER", active: true, transportCompanyId },
    } as never);

    const file = buildXlsx([HEADERS, dataRow()]);
    await expect(importAvailability(buildFormData(`W${runId}`, file))).rejects.toThrow(
      "NEXT_REDIRECT"
    );
  });

  it("records unknown driver as error", async () => {
    const file = buildXlsx([
      HEADERS,
      dataRow({ 1: unknownDriverEmail, 2: "Unknown Driver" }),
    ]);
    const result = await importAvailability(buildFormData(`W${runId}`, file));

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].reason).toContain("não encontrado");
  });


  describe("listAvailabilities", () => {
    it("lists imported availabilities for the selected week", async () => {
      const result = await listAvailabilities(weekId);

      expect(result.success).toBe(true);
      expect(result.rows.length).toBeGreaterThan(0);
      const row = result.rows.find((r) => r.userId === activeDriverId);
      expect(row).not.toBeUndefined();
      expect(row?.email).toBe(activeDriverEmail);
    });

    it("rejects week from another transport company", async () => {
      const otherCompany = await prisma.transportCompany.create({
        data: { name: "Other Company " + runId },
      });
      const otherWeek = await prisma.dispatchWeek.create({
        data: {
          transportCompanyId: otherCompany.id,
          weekKey: "WK-OTHER",
          year: 2026,
          weekNumber: 1,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-01-07"),
          status: "PLANNING",
        },
      });

      const result = await listAvailabilities(otherWeek.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/não pertence/);

      await prisma.dispatchWeek.delete({ where: { id: otherWeek.id } });
      await prisma.transportCompany.delete({ where: { id: otherCompany.id } });
    });
  });

  describe("approve/reject availability", () => {
    it("approves a pending availability", async () => {
      const availability = await prisma.driverAvailability.findFirst({
        where: { dispatchWeekId: weekId, userId: inactiveDriverId },
      });
      expect(availability).not.toBeNull();

      const result = await approveAvailability(availability!.id, "Ok para alocar");
      expect(result.success).toBe(true);

      const approval = await prisma.availabilityApproval.findUnique({
        where: { driverAvailabilityId: availability!.id },
      });
      expect(approval?.status).toBe("APPROVED");
      expect(approval?.notes).toBe("Ok para alocar");
    });

    it("rejects a pending availability", async () => {
      const availability = await prisma.driverAvailability.findFirst({
        where: { dispatchWeekId: weekId, userId: inactiveDriverId },
      });
      expect(availability).not.toBeNull();

      await prisma.availabilityApproval.update({
        where: { driverAvailabilityId: availability!.id },
        data: { status: "PENDING" },
      });

      const result = await rejectAvailability(availability!.id);
      expect(result.success).toBe(true);

      const approval = await prisma.availabilityApproval.findUnique({
        where: { driverAvailabilityId: availability!.id },
      });
      expect(approval?.status).toBe("REJECTED");
    });

    it("returns error when availability has no approval record", async () => {
      const availability = await prisma.driverAvailability.findFirst({
        where: { dispatchWeekId: weekId, userId: activeDriverId },
      });
      expect(availability).not.toBeNull();

      const result = await approveAvailability(availability!.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/não está aguardando aprovação/);
    });

    it("imports a large batch without transaction timeout", async () => {
      // Create 50 active drivers to stress-test the transaction.
      const drivers = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          prisma.user.create({
            data: {
              email: `bulk-active-${runId}-${i}@example.com`,
              name: `Bulk Driver ${i}`,
              role: "DRIVER",
              active: true,
              transportCompanyId,
            },
          })
        )
      );
      bulkDriverIds.push(...drivers.map((d) => d.id));

      const rows: unknown[][] = [HEADERS];
      for (let i = 0; i < drivers.length; i++) {
        rows.push(dataRow({ 1: drivers[i].email, 2: `Bulk Driver ${i}` }));
      }

      const result = await importAvailability(buildFormData(`W${runId}`, buildXlsx(rows)));
      expect(result.success).toBe(true);
      expect(result.imported).toBe(50);
      expect(result.errors).toHaveLength(0);

      const count = await prisma.driverAvailability.count({
        where: { dispatchWeekId: weekId },
      });
      expect(count).toBeGreaterThanOrEqual(50);
    });

    it("updates availability fields inline", async () => {
      const availability = await prisma.driverAvailability.findFirst({
        where: { dispatchWeekId: weekId, userId: activeDriverId },
      });
      expect(availability).not.toBeNull();

      const result = await updateAvailability(availability!.id, {
        sunAvailable: false,
        monAvailable: false,
        hasNaturalGas: true,
        speedAfternoon: false,
      });
      expect(result.success).toBe(true);

      const updated = await prisma.driverAvailability.findUnique({
        where: { id: availability!.id },
      });
      expect(updated?.sunAvailable).toBe(false);
      expect(updated?.monAvailable).toBe(false);
      expect(updated?.hasNaturalGas).toBe(true);
      expect(updated?.speedAfternoon).toBe(false);
      expect(updated?.importedById).toBe(supervisorId);
    });

    it("clears all availabilities from a week", async () => {
      const result = await clearWeek(weekId);
      expect(result.success).toBe(true);
      expect(result.deleted).toBeGreaterThan(0);

      const count = await prisma.driverAvailability.count({ where: { dispatchWeekId: weekId } });
      expect(count).toBe(0);
    });
  });

  describe("admin without transport company", () => {
    it("requires transportCompanyId when admin has no own company", async () => {
      await prisma.user.update({
        where: { id: supervisorId },
        data: { transportCompanyId: null },
      });
      mockAuth.mockResolvedValue({
        user: { id: supervisorId, role: "ADMIN", active: true, transportCompanyId: null },
      } as never);

      const file = buildXlsx([HEADERS, dataRow()]);
      const result = await importAvailability(buildFormData(`W${runId}`, file));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Selecione uma transportadora/);

      await prisma.user.update({
        where: { id: supervisorId },
        data: { transportCompanyId },
      });
    });

    it("imports using requested transportCompanyId", async () => {
      await prisma.user.update({
        where: { id: supervisorId },
        data: { transportCompanyId: null },
      });
      mockAuth.mockResolvedValue({
        user: { id: supervisorId, role: "ADMIN", active: true, transportCompanyId: null },
      } as never);

      const formData = buildFormData(`W${runId}`, buildXlsx([HEADERS, dataRow()]));
      formData.append("transportCompanyId", transportCompanyId);

      const result = await importAvailability(formData);
      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      await prisma.user.update({
        where: { id: supervisorId },
        data: { transportCompanyId },
      });
    });

    it("lists using requested transportCompanyId", async () => {
      await prisma.user.update({
        where: { id: supervisorId },
        data: { transportCompanyId: null },
      });
      mockAuth.mockResolvedValue({
        user: { id: supervisorId, role: "ADMIN", active: true, transportCompanyId: null },
      } as never);

      const result = await listAvailabilities(weekId, transportCompanyId);
      expect(result.success).toBe(true);
      expect(result.rows.length).toBeGreaterThan(0);

      await prisma.user.update({
        where: { id: supervisorId },
        data: { transportCompanyId },
      });
    });

    it("approves using requested transportCompanyId", async () => {
      // Re-import inactive driver since previous tests may have cleared the week.
      mockAuth.mockResolvedValue(session() as never);
      const file = buildXlsx([
        HEADERS,
        dataRow({ 1: inactiveDriverEmail, 2: "Inactive Driver" }),
      ]);
      await importAvailability(buildFormData(`W${runId}`, file));

      await prisma.user.update({
        where: { id: supervisorId },
        data: { transportCompanyId: null },
      });
      mockAuth.mockResolvedValue({
        user: { id: supervisorId, role: "ADMIN", active: true, transportCompanyId: null },
      } as never);

      const availability = await prisma.driverAvailability.findFirst({
        where: { dispatchWeekId: weekId, userId: inactiveDriverId },
      });
      expect(availability).not.toBeNull();

      await prisma.availabilityApproval.update({
        where: { driverAvailabilityId: availability!.id },
        data: { status: "PENDING" },
      });

      const result = await approveAvailability(availability!.id, "Ok", transportCompanyId);
      expect(result.success).toBe(true);

      await prisma.user.update({
        where: { id: supervisorId },
        data: { transportCompanyId },
      });
    });
  });
});
