// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { PerformanceClient } from "../client";

const mockImportPerformanceCsv = vi.fn();
const mockListPerformanceSnapshots = vi.fn();
const mockClearPerformanceWeek = vi.fn();

vi.mock("../actions", () => ({
  importPerformanceCsv: (...args: unknown[]) =>
    mockImportPerformanceCsv(...args),
  listPerformanceSnapshots: (...args: unknown[]) =>
    mockListPerformanceSnapshots(...args),
  clearPerformanceWeek: (...args: unknown[]) =>
    mockClearPerformanceWeek(...args),
}));

vi.mock("@/lib/week-utils", () => ({
  getCurrentIsoWeek: () => ({ year: 2026, weekNumber: 35 }),
  getPreviousIsoWeek: () => ({ year: 2026, weekNumber: 34 }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function buildWeek(
  id: string,
  weekKey: string,
  year: number,
  weekNumber: number,
  transportCompanyId = "tc-1",
  status = "PLANNING",
) {
  return {
    id,
    weekKey,
    year,
    weekNumber,
    startDate: "16/08",
    endDate: "22/08",
    transportCompanyId,
    status,
  };
}

const baseWeeks = [
  buildWeek("week-33", "WK-33", 2026, 33),
  buildWeek("week-34", "WK-34", 2026, 34),
  buildWeek("week-35", "WK-35", 2026, 35),
];

describe("PerformanceClient", () => {
  it("renders empty state when no snapshots exist", async () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    render(
      <PerformanceClient
        weeks={baseWeeks.filter((w) => w.weekNumber < 35)}
        initialWeekId="week-34"
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    expect(screen.getByText("Performance")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText("Nenhuma performance importada para esta semana"),
      ).toBeInTheDocument();
    });
  });

  it("renders imported snapshots in the table", async () => {
    mockListPerformanceSnapshots.mockResolvedValue({
      success: true,
      rows: [
        {
          id: "snap-1",
          name: "Marcelo Camargo",
          transporterId: "A3P2DUI47V0SU0",
          scoreText: "Fantastic",
          deliveredPackages: 725,
          dcr: 0.99,
          dnr: 0,
          insucessos: 7.25,
          contactCompliance: 1,
          swipeToFinishCompliance: 0.95,
          whc100: true,
          classification: "FANTASTIC",
        },
      ],
    });

    render(
      <PerformanceClient
        weeks={baseWeeks.filter((w) => w.weekNumber < 35)}
        initialWeekId="week-34"
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Marcelo Camargo")).toBeInTheDocument();
    });
    expect(screen.getByText("A3P2DUI47V0SU0")).toBeInTheDocument();
    expect(screen.getByText("Fantastic")).toBeInTheDocument();
    expect(screen.getByText("7.25")).toBeInTheDocument();
    expect(screen.getByText("7,25")).toBeInTheDocument();
  });

  it("disables import button when week is closed", () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    render(
      <PerformanceClient
        weeks={[buildWeek("week-34", "WK-34", 2026, 34, "tc-1", "CLOSED")]}
        initialWeekId="week-34"
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    const importButton = screen.getByRole("button", {
      name: /Importar performance/,
    });
    expect(importButton).toBeDisabled();
    expect(screen.getByText(/FECHADA/)).toBeInTheDocument();
  });

  it("calls import action when importing a file", async () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });
    mockImportPerformanceCsv.mockResolvedValue({
      success: true,
      weekKey: "WK-34",
      imported: 1,
      skipped: 0,
      errors: [],
    });

    render(
      <PerformanceClient
        weeks={baseWeeks.filter((w) => w.weekNumber < 35)}
        initialWeekId="week-34"
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Nenhuma performance importada para esta semana"),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Importar performance/ }),
    );

    const fileInput = screen.getByLabelText(/Arquivo/);
    const file = new File(["csv"], "performance.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    await waitFor(() => {
      expect(mockImportPerformanceCsv).toHaveBeenCalled();
    });
  });

  it("selects the previous ISO week by default", () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    render(
      <PerformanceClient
        weeks={baseWeeks.filter((w) => w.weekNumber < 35)}
        initialWeekId="week-34"
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    const weekSelect = screen.getByLabelText("Semana") as HTMLSelectElement;
    expect(weekSelect.value).toBe("week-34");
  });

  it("does not render current or future weeks in the selector", () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    render(
      <PerformanceClient
        weeks={baseWeeks.filter((w) => w.weekNumber < 35)}
        initialWeekId="week-34"
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.some((text) => text?.includes("WK-35"))).toBe(false);
    expect(options.some((text) => text?.includes("WK-36"))).toBe(false);
  });

  it("keeps historical weeks available in the selector", () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    render(
      <PerformanceClient
        weeks={baseWeeks.filter((w) => w.weekNumber < 35)}
        initialWeekId="week-34"
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.some((text) => text?.includes("WK-34"))).toBe(true);
    expect(options.some((text) => text?.includes("WK-33"))).toBe(true);
  });

  it("recalculates selected week to the previous week when changing company", async () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    const companies = [
      { id: "tc-a", name: "Transportadora A" },
      { id: "tc-b", name: "Transportadora B" },
    ];
    const weeks = [
      buildWeek("wa-33", "WK-33", 2026, 33, "tc-a"),
      buildWeek("wa-34", "WK-34", 2026, 34, "tc-a"),
      buildWeek("wb-33", "WK-33", 2026, 33, "tc-b"),
      buildWeek("wb-34", "WK-34", 2026, 34, "tc-b"),
    ];

    render(
      <PerformanceClient
        weeks={weeks}
        initialWeekId="wa-34"
        hasTransportCompany={false}
        companies={companies}
        userRole="ADMIN"
      />,
    );

    const weekSelect = screen.getByLabelText("Semana") as HTMLSelectElement;
    expect(weekSelect.value).toBe("wa-34");

    const companySelect = screen.getByLabelText(
      "Transportadora",
    ) as HTMLSelectElement;
    fireEvent.change(companySelect, { target: { value: "tc-b" } });

    await waitFor(() => {
      expect(weekSelect.value).toBe("wb-34");
    });
  });

  it("shows empty state when no past weeks are available", () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    render(
      <PerformanceClient
        weeks={[]}
        initialWeekId=""
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    expect(
      screen.getByText("Nenhuma semana anterior disponível"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Aguarde a criação automática da próxima semana."),
    ).toBeInTheDocument();
  });
});
