import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Server action tests for dispatch vacancy management.
// ---------------------------------------------------------------------------

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  dispatchWeek: {
    findUnique: vi.fn(),
  },
  vacancy: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

const mockWriteAuditLog = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const {
  createVacancy,
  updateVacancy,
  deleteVacancy,
  listVacancies,
  listActiveDrivers,
} = await import("@/app/(protected)/dispatch/actions");

beforeEach(() => {
  vi.clearAllMocks();
});

function sessionWithRole(role: string, transportCompanyId: string | null = "tc-1") {
  return {
    user: { id: "actor-id", role, active: true, transportCompanyId },
  };
}

const validInput = {
  dispatchWeekId: "week-1",
  date: "2026-08-17",
  vehicleType: "CARGO_VAN" as const,
  shiftBlock: "Manhã",
  quantity: 3,
};

describe("createVacancy", () => {
  it("rejects DRIVER with 'Permissão insuficiente.'", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(createVacancy(validInput)).rejects.toThrow("Permissão insuficiente.");
  });

  it("rejects unauthenticated with 'Não autenticado.'", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(createVacancy(validInput)).rejects.toThrow("Não autenticado.");
  });

  it("validates required fields", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    const result = await createVacancy({ ...validInput, date: "" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Data/);
  });

  it("validates vehicle type", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    const result = await createVacancy({ ...validInput, vehicleType: "INVALID" as unknown as "CARGO_VAN" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Categoria/);
  });

  it("validates minimum quantity", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    const result = await createVacancy({ ...validInput, quantity: 0 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Quantidade/);
  });

  it("rejects when user has no transport company", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", null));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: null });
    const result = await createVacancy(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/transportadora/);
  });

  it("rejects when dispatch week belongs to another transport company", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.dispatchWeek.findUnique.mockResolvedValue({ transportCompanyId: "tc-2" });
    const result = await createVacancy(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/não pertence/);
  });

  it("creates vacancy and writes audit log for SUPERVISOR", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.dispatchWeek.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.create.mockResolvedValue({ id: "vacancy-1", ...validInput, date: new Date(validInput.date) });

    const result = await createVacancy(validInput);
    expect(result.success).toBe(true);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "VACANCY_PUBLISHED",
        actorId: "actor-id",
      })
    );
  });

  it("creates vacancy for ACCOUNT_MANAGER", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("ACCOUNT_MANAGER", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.dispatchWeek.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.create.mockResolvedValue({ id: "vacancy-1", ...validInput, date: new Date(validInput.date) });

    const result = await createVacancy(validInput);
    expect(result.success).toBe(true);
  });

  it("creates vacancy for ADMIN", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("ADMIN", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.dispatchWeek.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.create.mockResolvedValue({ id: "vacancy-1", ...validInput, date: new Date(validInput.date) });

    const result = await createVacancy(validInput);
    expect(result.success).toBe(true);
  });
});

describe("updateVacancy", () => {
  it("rejects DRIVER", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(updateVacancy("v-1", validInput)).rejects.toThrow("Permissão insuficiente.");
  });

  it("rejects invalid data", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    const result = await updateVacancy("v-1", { ...validInput, quantity: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects when vacancy not found", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.findUnique.mockResolvedValue(null);
    const result = await updateVacancy("v-1", validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/não encontrada/);
  });

  it("updates vacancy and writes audit log", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.findUnique.mockResolvedValue({
      id: "v-1",
      dispatchWeekId: "week-1",
      dispatchWeek: { transportCompanyId: "tc-1" },
      date: new Date("2026-08-17"),
      vehicleType: "CARGO_VAN",
      shiftBlock: "Manhã",
      quantity: 2,
    });
    mockPrisma.dispatchWeek.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.update.mockResolvedValue({ id: "v-1", ...validInput, date: new Date(validInput.date) });

    const result = await updateVacancy("v-1", validInput);
    expect(result.success).toBe(true);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "VACANCY_UPDATED",
        actorId: "actor-id",
      })
    );
  });
});

describe("deleteVacancy", () => {
  it("rejects DRIVER", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(deleteVacancy("v-1")).rejects.toThrow("Permissão insuficiente.");
  });

  it("rejects when vacancy not found", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.findUnique.mockResolvedValue(null);
    const result = await deleteVacancy("v-1");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/não encontrada/);
  });

  it("deletes vacancy and writes audit log", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.findUnique.mockResolvedValue({
      id: "v-1",
      dispatchWeekId: "week-1",
      dispatchWeek: { transportCompanyId: "tc-1" },
      date: new Date("2026-08-17"),
      vehicleType: "CARGO_VAN",
      shiftBlock: "Manhã",
      quantity: 2,
    });

    const result = await deleteVacancy("v-1");
    expect(result.success).toBe(true);
    expect(mockPrisma.vacancy.delete).toHaveBeenCalledWith({ where: { id: "v-1" } });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "VACANCY_UPDATED",
        actorId: "actor-id",
      })
    );
  });
});

describe("listVacancies", () => {
  it("rejects DRIVER", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(listVacancies("week-1")).rejects.toThrow("Permissão insuficiente.");
  });

  it("lists vacancies for allowed role", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.dispatchWeek.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.vacancy.findMany.mockResolvedValue([
      { id: "v-1", date: new Date("2026-08-17"), vehicleType: "CARGO_VAN", shiftBlock: "Manhã", quantity: 2 },
    ]);

    const result = await listVacancies("week-1");
    expect(result.success).toBe(true);
    expect(result.vacancies).toHaveLength(1);
  });
});

describe("listActiveDrivers", () => {
  it("rejects DRIVER", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("DRIVER"));
    await expect(listActiveDrivers()).rejects.toThrow("Permissão insuficiente.");
  });

  it("lists active drivers for allowed role", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("SUPERVISOR", "tc-1"));
    mockPrisma.user.findUnique.mockResolvedValue({ transportCompanyId: "tc-1" });
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u-1", name: "Driver A", email: "a@example.com", driverProfile: { id: "dp-1", vehicleType: "CARGO_VAN", onboardingCompleted: true } },
    ]);

    const result = await listActiveDrivers();
    expect(result.success).toBe(true);
    expect(result.drivers).toHaveLength(1);
    expect(result.drivers[0].driverProfile?.vehicleType).toBe("CARGO_VAN");
  });
});
