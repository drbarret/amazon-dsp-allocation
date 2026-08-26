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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseWeeks = [
  {
    id: "week-1",
    weekKey: "WK-33",
    startDate: "16/08",
    endDate: "22/08",
    transportCompanyId: "tc-1",
    status: "PLANNING",
  },
];

describe("PerformanceClient", () => {
  it("renders empty state when no snapshots exist", async () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    render(
      <PerformanceClient
        weeks={baseWeeks}
        initialWeekId="week-1"
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
          score: 100,
          deliveredPackages: 725,
          dcr: 0.99,
          dnr: 0,
          insucessos: 7,
          classification: "FANTASTIC_PLUS",
        },
      ],
    });

    render(
      <PerformanceClient
        weeks={baseWeeks}
        initialWeekId="week-1"
        hasTransportCompany={true}
        companies={[]}
        userRole="SUPERVISOR"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Marcelo Camargo")).toBeInTheDocument();
    });
    expect(screen.getByText("A3P2DUI47V0SU0")).toBeInTheDocument();
    expect(screen.getAllByText("7")).toHaveLength(2); // summary card + table cell
  });

  it("disables import button when week is closed", () => {
    mockListPerformanceSnapshots.mockResolvedValue({ success: true, rows: [] });

    render(
      <PerformanceClient
        weeks={[{ ...baseWeeks[0], status: "CLOSED" }]}
        initialWeekId="week-1"
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
      weekKey: "WK-33",
      imported: 1,
      skipped: 0,
      errors: [],
    });

    render(
      <PerformanceClient
        weeks={baseWeeks}
        initialWeekId="week-1"
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
});
