// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/lib/driver-actions", () => ({
  setDriverGnvMarking: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../actions", () => ({
  saveDriverEdits: vi.fn().mockResolvedValue({ success: true }),
  requestDriverDeactivation: vi.fn().mockResolvedValue({ success: true }),
  reviewDeactivationRequest: vi.fn().mockResolvedValue({ success: true }),
  getPendingDeactivationCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/app/(protected)/admin/users/actions", () => ({
  reactivateUser: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { DriversClient } from "../client";
import type { DriverRow } from "../page";

afterEach(cleanup);

const sampleDrivers: DriverRow[] = [
  {
    userId: "u1",
    name: "Rafael Almeida",
    email: "rafael.almeida@exemplo.com",
    vehicleType: "CARGO_VAN",
    hasGnv: false,
    onboardingCompleted: true,
    transporterId: "T001",
    worksCiclo1: true,
    worksCiclo2: false,
    isTrusted: false,
    whatsappGroup: "Grupo Jundiaí",
    phoneFormatted: "(11) 99999-0001",
    cities: ["Jundiaí"],
    active: true,
    deactivatedByRole: null,
  },
  {
    userId: "u2",
    name: "Beatriz Nogueira",
    email: "beatriz.nogueira@exemplo.com",
    vehicleType: "PASSEIO",
    hasGnv: true,
    onboardingCompleted: true,
    transporterId: "T002",
    worksCiclo1: false,
    worksCiclo2: true,
    isTrusted: true,
    whatsappGroup: null,
    phoneFormatted: "(11) 99999-0002",
    cities: ["Louveira", "Vinhedo"],
    active: true,
    deactivatedByRole: null,
  },
  {
    userId: "u3",
    name: "Carlos Eduardo Lima",
    email: "carlos.lima@exemplo.com",
    vehicleType: "CARGO_VAN",
    hasGnv: false,
    onboardingCompleted: false,
    transporterId: null,
    worksCiclo1: false,
    worksCiclo2: false,
    isTrusted: false,
    whatsappGroup: null,
    phoneFormatted: null,
    cities: [],
    active: false,
    deactivatedByRole: "SUPERVISOR",
  },
];

const defaultProps = {
  drivers: sampleDrivers,
  currentActorRole: "SUPERVISOR",
  pendingDeactivationCount: 0,
  initialStatusFilter: "active",
};

describe("DriversClient — render", () => {
  it("com dados: mostra cabeçalho, busca e linhas da tabela", () => {
    render(<DriversClient {...defaultProps} />);

    expect(screen.getByText("Motoristas")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Buscar por nome/),
    ).toBeInTheDocument();

    expect(screen.getByText("Rafael Almeida")).toBeInTheDocument();
    expect(screen.getByText("Beatriz Nogueira")).toBeInTheDocument();
    expect(screen.getByText("Carlos Eduardo Lima")).toBeInTheDocument();

    // Contagem no rodapé
    expect(screen.getByText(/Mostrando 3 de 3 motoristas/)).toBeInTheDocument();
  });

  it("vazio: sem motoristas mostra EmptyState com orientação", () => {
    render(<DriversClient {...defaultProps} drivers={[]} />);

    expect(screen.getByText("Nenhum motorista cadastrado")).toBeInTheDocument();
  });

  it("busca sem resultado: EmptyState orienta a limpar a busca", () => {
    render(<DriversClient {...defaultProps} />);

    const input = screen.getByPlaceholderText(/Buscar por nome/);
    fireEvent.change(input, { target: { value: "zzzznada" } });

    expect(
      screen.getByText("Nenhum motorista encontrado para esta busca"),
    ).toBeInTheDocument();
  });

  it("tabela tem aria-label para leitores de tela", () => {
    render(<DriversClient {...defaultProps} />);
    expect(screen.getByRole("table")).toHaveAttribute(
      "aria-label",
      "Motoristas cadastrados",
    );
  });

  it("mostra badge de pendência quando há solicitações", () => {
    render(<DriversClient {...defaultProps} pendingDeactivationCount={2} />);
    expect(screen.getByText(/2 solicitação/)).toBeInTheDocument();
  });
});
