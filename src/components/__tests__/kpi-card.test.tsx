// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { KpiCard } from "@/components/kpi-card";
import { UsersIcon } from "lucide-react";

afterEach(cleanup);

describe("KpiCard", () => {
  it("renderiza rótulo, valor e legenda (ready)", () => {
    render(
      <KpiCard label="Motoristas Ativos" value={42} hint="cadastrados no sistema" />,
    );
    expect(screen.getByText("Motoristas Ativos")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("cadastrados no sistema")).toBeInTheDocument();
  });

  it("estado loading mostra skeleton e esconde o valor", () => {
    render(<KpiCard label="Vagas" value={10} loading />);
    expect(screen.getByTestId("kpi-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("10")).not.toBeInTheDocument();
    // rótulo continua visível durante a carga
    expect(screen.getByText("Vagas")).toBeInTheDocument();
  });

  it("aplica tom semântico no valor", () => {
    const { container } = render(
      <KpiCard label="CNHs vencidas" value={3} tone="danger" />,
    );
    expect(container.querySelector(".text-danger-fg")).not.toBeNull();
  });

  it("renderiza ícone quando informado", () => {
    const { container } = render(
      <KpiCard label="Motoristas" value={5} icon={UsersIcon} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
