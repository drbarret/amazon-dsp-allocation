// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { DispatchClient } from "../client";

const { mockListVacancies } = vi.hoisted(() => ({
  mockListVacancies: vi.fn(),
}));

vi.mock("../actions", () => ({
  listVacancies: mockListVacancies,
  createVacancy: vi.fn(),
  updateVacancy: vi.fn(),
  deleteVacancy: vi.fn(),
  runDistribution: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const WEEK = {
  id: "w1",
  transportCompanyId: "tc1",
  weekKey: "WK-33",
  year: 2026,
  weekNumber: 33,
  startDate: new Date("2026-08-16T00:00:00.000Z"),
  endDate: new Date("2026-08-22T00:00:00.000Z"),
  status: "PLANNING",
  createdById: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
} as const;

const VACANCY = {
  id: "v1",
  dispatchWeekId: "w1",
  date: new Date("2026-08-17T00:00:00.000Z"),
  vehicleType: "CARGO_VAN",
  shiftBlock: "Ciclo 1 - Manhã",
  quantity: 18,
  createdById: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
} as const;

describe("DispatchClient", () => {
  it("sem semanas: mostra EmptyState explicando que nenhuma DispatchWeek existe (não parece quebrado)", () => {
    render(<DispatchClient weeks={[]} drivers={[]} hasTransportCompany />);

    expect(
      screen.getByText("Nenhuma semana de distribuição cadastrada"),
    ).toBeInTheDocument();
    expect(screen.getByText(/próxima fase/)).toBeInTheDocument();
    // Sem seletor de semana e sem ações operacionais.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Distribuir vagas/ }),
    ).not.toBeInTheDocument();
  });

  it("loading: enquanto as vagas carregam, mostra skeleton e não o estado vazio", async () => {
    let resolve!: (v: unknown) => void;
    mockListVacancies.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );

    render(<DispatchClient weeks={[WEEK]} drivers={[]} hasTransportCompany />);

    await waitFor(() =>
      expect(
        screen.getAllByTestId("datatable-skeleton-row").length,
      ).toBeGreaterThan(0),
    );
    expect(
      screen.queryByText("Nenhuma vaga cadastrada para esta semana"),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolve({ success: true, vacancies: [] });
    });
  });

  it("vazio: semana sem vagas mostra EmptyState com ação Nova Vaga", async () => {
    mockListVacancies.mockResolvedValue({ success: true, vacancies: [] });

    render(<DispatchClient weeks={[WEEK]} drivers={[]} hasTransportCompany />);

    await waitFor(() =>
      expect(
        screen.getByText("Nenhuma vaga cadastrada para esta semana"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getAllByRole("button", { name: /Nova Vaga/ }).length,
    ).toBeGreaterThan(0);
  });

  it("com dados: renderiza linhas de vagas", async () => {
    mockListVacancies.mockResolvedValue({ success: true, vacancies: [VACANCY] });

    render(<DispatchClient weeks={[WEEK]} drivers={[]} hasTransportCompany />);

    await waitFor(() =>
      expect(screen.getByText("Ciclo 1 - Manhã")).toBeInTheDocument(),
    );
    expect(screen.getByText("Cargo Van")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
  });
});
