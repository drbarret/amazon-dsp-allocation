// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { UserRole } from "@/generated/prisma";

vi.mock("../actions", () => ({
  importAvailability: vi.fn().mockResolvedValue({
    success: true,
    week: "WK-35",
    imported: 0,
    pendingApproval: 0,
    errors: [],
  }),
  listAvailabilities: vi.fn().mockResolvedValue({ success: true, rows: [] }),
  approveAvailability: vi.fn().mockResolvedValue({ success: true }),
  rejectAvailability: vi.fn().mockResolvedValue({ success: true }),
  updateAvailability: vi.fn().mockResolvedValue({ success: true }),
  clearWeek: vi.fn().mockResolvedValue({ success: true, deleted: 0 }),
}));

vi.mock("@/lib/availability/template", () => ({
  downloadAvailabilityTemplate: vi.fn().mockReturnValue({
    buffer: new ArrayBuffer(0),
    filename: "template.xlsx",
  }),
}));

import { DisponibilidadesClient } from "../client";
import { listAvailabilities } from "../actions";

afterEach(cleanup);

const baseWeek = {
  id: "w1",
  weekKey: "WK-35",
  startDate: "23/08",
  endDate: "29/08",
  transportCompanyId: "c1",
};

const sampleRow = {
  id: "a1",
  userId: "u1",
  name: "Motorista A",
  email: "motorista@exemplo.com",
  filledAt: null,
  hasNaturalGas: false,
  isPassengerCar: false,
  sunAvailable: true,
  monAvailable: true,
  tueAvailable: true,
  wedAvailable: true,
  thuAvailable: true,
  friAvailable: true,
  satAvailable: false,
  speedAfternoon: false,
  approval: null,
};

const defaultProps = {
  weeks: [baseWeek],
  initialWeekId: "w1",
  hasTransportCompany: true,
  companies: [{ id: "c1", name: "Transportadora A" }],
  userRole: "SUPERVISOR" as UserRole,
};

describe("DisponibilidadesClient — semana fechada", () => {
  it("mostra o status da semana no seletor", () => {
    render(
      <DisponibilidadesClient
        {...defaultProps}
        weeks={[{ ...baseWeek, status: "PLANNING" }]}
      />
    );
    expect(screen.getByText(/PLANNING/)).toBeInTheDocument();
  });

  it("desabilita importação, edição inline e limpeza quando a semana está CLOSED", async () => {
    vi.mocked(listAvailabilities).mockResolvedValue({
      success: true,
      rows: [sampleRow],
    });

    render(
      <DisponibilidadesClient
        {...defaultProps}
        weeks={[{ ...baseWeek, status: "CLOSED" }]}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Importar disponibilidades/ })
      ).toBeDisabled();
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Limpar semana/ })
      ).toBeDisabled();
    });

    await waitFor(() => {
      const editButton = screen.getByRole("button", { name: /Editar/ });
      expect(editButton).toBeDisabled();
    });

    expect(screen.getByText(/FECHADA/)).toBeInTheDocument();
  });

  it("mantém ações habilitadas para semana PLANNING", async () => {
    vi.mocked(listAvailabilities).mockResolvedValue({
      success: true,
      rows: [sampleRow],
    });

    render(
      <DisponibilidadesClient
        {...defaultProps}
        weeks={[{ ...baseWeek, status: "PLANNING" }]}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Importar disponibilidades/ })
      ).not.toBeDisabled();
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Limpar semana/ })
      ).not.toBeDisabled();
    });

    await waitFor(() => {
      const editButton = screen.getByRole("button", { name: /Editar/ });
      expect(editButton).not.toBeDisabled();
    });

    expect(screen.queryByText(/FECHADA/)).not.toBeInTheDocument();
  });
});
