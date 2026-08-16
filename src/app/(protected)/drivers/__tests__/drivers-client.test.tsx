// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks: o client usa server actions e componentes de UI. Mockamos as actions
// para não tocar em banco/rede, e renderizamos o JSX diretamente no jsdom.
// ---------------------------------------------------------------------------

vi.mock("@/lib/driver-actions", () => ({
  setDriverGnvMarking: vi.fn().mockResolvedValue({ success: true }),
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
  },
  {
    userId: "u2",
    name: "Beatriz Nogueira",
    email: "beatriz.nogueira@exemplo.com",
    vehicleType: "PASSEIO",
    hasGnv: true,
    onboardingCompleted: true,
  },
  {
    userId: "u3",
    name: "Carlos Eduardo Lima",
    email: "carlos.lima@exemplo.com",
    vehicleType: "CARGO_VAN",
    hasGnv: false,
    onboardingCompleted: false,
  },
];

describe("DriversClient — render", () => {
  it("com dados: mostra cabeçalho, busca e linhas da tabela", () => {
    render(<DriversClient drivers={sampleDrivers} />);

    expect(screen.getByText("Motoristas")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Buscar por nome ou e-mail..."),
    ).toBeInTheDocument();

    expect(screen.getByText("Rafael Almeida")).toBeInTheDocument();
    expect(screen.getByText("Beatriz Nogueira")).toBeInTheDocument();
    expect(screen.getByText("Carlos Eduardo Lima")).toBeInTheDocument();

    // E-mails como linha secundária
    expect(
      screen.getByText("rafael.almeida@exemplo.com"),
    ).toBeInTheDocument();

    // StatusPills de veículo e cadastro
    expect(screen.getAllByText("Cargo Van").length).toBeGreaterThan(0);
    expect(screen.getByText("Veículo de Passeio")).toBeInTheDocument();
    expect(screen.getAllByText("Completo").length).toBe(2);
    expect(screen.getByText("Pendente")).toBeInTheDocument();

    // GNV pill para quem tem (header "GNV" + pill "GNV" = 2 elementos)
    expect(screen.getAllByText("GNV").length).toBeGreaterThanOrEqual(2);

    // Contagem no rodapé
    expect(screen.getByText(/Mostrando 3 de 3 motoristas/)).toBeInTheDocument();
  });

  it("vazio: sem motoristas mostra EmptyState com orientação", () => {
    render(<DriversClient drivers={[]} />);

    expect(screen.getByText("Nenhum motorista cadastrado")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Os motoristas aparecem aqui após concluírem o cadastro.",
      ),
    ).toBeInTheDocument();
  });

  it("busca sem resultado: EmptyState orienta a limpar a busca", () => {
    render(<DriversClient drivers={sampleDrivers} />);

    const input = screen.getByPlaceholderText("Buscar por nome ou e-mail...");
    fireEvent.change(input, { target: { value: "zzzznada" } });

    expect(
      screen.getByText("Nenhum motorista encontrado para esta busca"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Limpe a busca ou ajuste os critérios para ver mais resultados.",
      ),
    ).toBeInTheDocument();
  });

  it("cada motorista tem checkbox GNV com aria-label acessível", () => {
    render(<DriversClient drivers={sampleDrivers} />);

    expect(
      screen.getByLabelText("Marcar GNV para Rafael Almeida"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Marcar GNV para Beatriz Nogueira"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Marcar GNV para Carlos Eduardo Lima"),
    ).toBeInTheDocument();
  });

  it("tabela tem aria-label para leitores de tela", () => {
    render(<DriversClient drivers={sampleDrivers} />);
    expect(screen.getByRole("table")).toHaveAttribute(
      "aria-label",
      "Motoristas cadastrados",
    );
  });
});
