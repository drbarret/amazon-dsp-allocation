// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks: a page é um async server component. Mockamos auth, as fontes de
// dados (prisma + findExpiredCnhDrivers) e o Link do Next para renderizar o
// JSX retornado diretamente no jsdom.
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth(),
}));

const mockCountUser = vi.fn();
const mockFindManyWeek = vi.fn();
const mockFindFirstWeek = vi.fn();
const mockAggregateVacancy = vi.fn();
const mockCountInfraction = vi.fn();
const mockFindUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: (...args: unknown[]) => mockCountUser(...args),
      findUnique: (...args: unknown[]) => mockFindUniqueUser(...args),
    },
    dispatchWeek: {
      findMany: (...args: unknown[]) => mockFindManyWeek(...args),
      findFirst: (...args: unknown[]) => mockFindFirstWeek(...args),
    },
    vacancy: {
      aggregate: (...args: unknown[]) => mockAggregateVacancy(...args),
    },
    driverInfraction: {
      count: (...args: unknown[]) => mockCountInfraction(...args),
    },
  },
}));

const mockFindExpired = vi.fn();
vi.mock("@/lib/cnh-collection", () => ({
  findExpiredCnhDrivers: (...args: unknown[]) => mockFindExpired(...args),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href, ...props }, children),
}));

import DashboardPage from "../page";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  // Padrões: supervisor com transportadora, semanas existentes, números > 0
  mockFindUniqueUser.mockResolvedValue({ transportCompanyId: "tc-1" });
  mockCountUser.mockResolvedValue(42);
  mockFindExpired.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  mockCountInfraction.mockResolvedValue(5);
  mockFindFirstWeek.mockResolvedValue({ id: "week-current" });
  mockAggregateVacancy.mockResolvedValue({ _sum: { quantity: 128 } });
  mockFindManyWeek.mockResolvedValue([
    {
      id: "w1",
      weekNumber: 33,
      status: "PLANNING",
      startDate: new Date("2026-08-16T00:00:00Z"),
      endDate: new Date("2026-08-22T00:00:00Z"),
    },
  ]);
});

function sessionFor(role: string) {
  return { user: { id: "u1", name: "Marcos Souza", role } };
}

async function renderDashboard(role: string) {
  mockAuth.mockResolvedValue(sessionFor(role));
  const ui = await DashboardPage();
  return render(ui);
}

describe("Dashboard — visão SUPERVISOR+", () => {
  it("mostra os 4 KPIs com os números das fontes dedicadas", async () => {
    await renderDashboard("SUPERVISOR");
    expect(screen.getByText("Motoristas Ativos")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Vagas da Semana")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("CNHs Vencidas")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Infrações Pendentes")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("conta motoristas com o MESMO filtro da tela /drivers (role+active+perfil)", async () => {
    await renderDashboard("SUPERVISOR");
    expect(mockCountUser).toHaveBeenCalledWith({
      where: { role: "DRIVER", active: true, driverProfile: { isNot: null } },
    });
  });

  it("conta infrações da fila de aprovação (PENDING_APPROVAL) da transportadora", async () => {
    await renderDashboard("SUPERVISOR");
    expect(mockCountInfraction).toHaveBeenCalledWith({
      where: {
        status: "PENDING_APPROVAL",
        driverProfile: { user: { transportCompanyId: "tc-1" } },
      },
    });
  });

  it("ACCOUNT_MANAGER e ADMIN também veem os KPIs", async () => {
    const { unmount } = await renderDashboard("ACCOUNT_MANAGER");
    expect(screen.getByText("Motoristas Ativos")).toBeInTheDocument();
    unmount();
    await renderDashboard("ADMIN");
    expect(screen.getByText("Motoristas Ativos")).toBeInTheDocument();
  });

  it("lista as próximas semanas com StatusPill", async () => {
    await renderDashboard("SUPERVISOR");
    expect(screen.getByText("Próximas semanas")).toBeInTheDocument();
    expect(screen.getByText("Semana 33")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
  });

  it("mostra atalhos para as 3 telas operacionais", async () => {
    await renderDashboard("SUPERVISOR");
    for (const label of ["Disponibilidades", "Motoristas", "Cobrar CNH"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("Dashboard — estado sem semana cadastrada", () => {
  it("renderiza EmptyState com orientação em vez de quebrar ou mentir número", async () => {
    mockFindManyWeek.mockResolvedValue([]);
    mockFindFirstWeek.mockResolvedValue(null);
    mockAggregateVacancy.mockResolvedValue(null);
    await renderDashboard("SUPERVISOR");
    expect(
      screen.getByText("Nenhuma semana cadastrada"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/As disponibilidades são gerenciadas na tela Disponibilidades/),
    ).toBeInTheDocument();
    // KPI de vagas mostra "—" e hint honesto, não um número enganoso
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText("nenhuma semana corrente cadastrada"),
    ).toBeInTheDocument();
  });
});

describe("Dashboard — visão DRIVER", () => {
  it("NÃO mostra KPIs operacionais nem a lista de semanas", async () => {
    await renderDashboard("DRIVER");
    expect(screen.queryByText("Motoristas Ativos")).not.toBeInTheDocument();
    expect(screen.queryByText("Vagas da Semana")).not.toBeInTheDocument();
    expect(screen.queryByText("CNHs Vencidas")).not.toBeInTheDocument();
    expect(screen.queryByText("Infrações Pendentes")).not.toBeInTheDocument();
    expect(screen.queryByText("Próximas semanas")).not.toBeInTheDocument();
    expect(screen.queryByText("Acesso rápido")).not.toBeInTheDocument();
  });

  it("mantém a confirmação de cadastro com a nota discreta de disponibilidade", async () => {
    await renderDashboard("DRIVER");
    expect(screen.getByText("Cadastro concluído")).toBeInTheDocument();
    expect(
      screen.getByText("Em breve: disponibilidade semanal."),
    ).toBeInTheDocument();
  });

  it("DRIVER não dispara nenhuma query operacional", async () => {
    await renderDashboard("DRIVER");
    expect(mockCountUser).not.toHaveBeenCalled();
    expect(mockFindManyWeek).not.toHaveBeenCalled();
    expect(mockCountInfraction).not.toHaveBeenCalled();
    expect(mockFindExpired).not.toHaveBeenCalled();
  });
});
