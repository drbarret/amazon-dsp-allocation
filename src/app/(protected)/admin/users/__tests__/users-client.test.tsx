// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks: as server actions são mockadas para não tocar em banco/rede.
// ---------------------------------------------------------------------------

vi.mock("../actions", () => ({
  changeUserRole: vi.fn().mockResolvedValue({ success: true }),
  deactivateUser: vi.fn().mockResolvedValue({ success: true }),
  reactivateUser: vi.fn().mockResolvedValue({ success: true }),
  inviteUser: vi.fn().mockResolvedValue({ success: true }),
  revokeInvite: vi.fn().mockResolvedValue({ success: true }),
  updateDriverCnh: vi.fn().mockResolvedValue({ success: true }),
  updateDriverCityPreferences: vi.fn().mockResolvedValue({ success: true }),
  updateDriverVehicleType: vi.fn().mockResolvedValue({ success: true }),
}));

import { UserManagementClient } from "../client";
import type { UserRow } from "../page";

afterEach(cleanup);

const sampleUsers: UserRow[] = [
  {
    id: "u1",
    name: "Marcos Souza",
    email: "marcos.souza@exemplo.com",
    role: "SUPERVISOR",
    active: true,
    onboardingCompleted: null,
    lastLoginAt: "2026-08-16T11:02:00.000Z",
    source: "user",
  },
  {
    id: "u2",
    name: "Rafael Almeida",
    email: "rafael.almeida@exemplo.com",
    role: "DRIVER",
    active: true,
    onboardingCompleted: true,
    lastLoginAt: "2026-08-15T18:40:00.000Z",
    source: "user",
    cnhExpiration: "2027-12-15T00:00:00.000Z",
    cityPreferences: ["Guarulhos", "São Paulo"],
    vehicleType: "CARGO_VAN",
  },
  {
    id: "u3",
    name: "Beatriz Nogueira",
    email: "beatriz.nogueira@exemplo.com",
    role: "DRIVER",
    active: true,
    onboardingCompleted: true,
    lastLoginAt: "2026-08-14T07:15:00.000Z",
    source: "user",
    cnhExpiration: "2026-03-20T00:00:00.000Z",
    cityPreferences: ["Osasco"],
    vehicleType: "PASSEIO",
  },
  {
    id: "u4",
    name: "João Pedro Santos",
    email: "joao.santos@exemplo.com",
    role: "DRIVER",
    active: false,
    onboardingCompleted: true,
    lastLoginAt: "2026-07-22T16:51:00.000Z",
    source: "user",
    cnhExpiration: "2025-05-10T00:00:00.000Z",
    cityPreferences: ["Mairiporã"],
    vehicleType: "PASSEIO",
  },
  {
    id: "inv1",
    name: "paula.mendes",
    email: "paula.mendes@exemplo.com",
    role: "ACCOUNT_MANAGER",
    active: true,
    onboardingCompleted: null,
    lastLoginAt: null,
    source: "invite",
    allowedEmailId: "ae1",
    allowedEmailStatus: "ACTIVE",
  },
];

const roleLabels: Record<string, string> = {
  ADMIN: "Admin",
  ACCOUNT_MANAGER: "Gerente de Contas",
  SUPERVISOR: "Supervisor",
  DRIVER: "Motorista",
};

describe("UserManagementClient — render", () => {
  it("com dados: mostra cabeçalho, busca e linhas da tabela", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    expect(screen.getByText("Usuários")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Buscar por nome, e-mail ou papel..."),
    ).toBeInTheDocument();

    // Nomes
    expect(screen.getByText("Marcos Souza")).toBeInTheDocument();
    expect(screen.getByText("Rafael Almeida")).toBeInTheDocument();
    expect(screen.getByText("Beatriz Nogueira")).toBeInTheDocument();
    expect(screen.getByText("João Pedro Santos")).toBeInTheDocument();

    // E-mails como linha secundária
    expect(
      screen.getByText("marcos.souza@exemplo.com"),
    ).toBeInTheDocument();

    // Status pills
    expect(screen.getAllByText("Ativo").length).toBeGreaterThan(0);
    expect(screen.getByText("Inativo")).toBeInTheDocument();

    // Contagem no rodapé
    expect(
      screen.getByText(/Mostrando 5 de 5 usuários/),
    ).toBeInTheDocument();
  });

  it("vazio: sem usuários mostra EmptyState com orientação", () => {
    render(
      <UserManagementClient
        users={[]}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    expect(screen.getByText("Nenhum usuário cadastrado")).toBeInTheDocument();
    expect(
      screen.getByText("Convide o primeiro usuário para começar."),
    ).toBeInTheDocument();
  });

  it("busca sem resultado: EmptyState orienta a limpar a busca", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    const input = screen.getByPlaceholderText(
      "Buscar por nome, e-mail ou papel...",
    );
    fireEvent.change(input, { target: { value: "zzzznada" } });

    expect(
      screen.getByText("Nenhum usuário encontrado para esta busca"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Limpe a busca ou ajuste os critérios para ver mais resultados.",
      ),
    ).toBeInTheDocument();
  });

  it("tabela tem aria-label para leitores de tela", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );
    expect(screen.getByRole("table")).toHaveAttribute(
      "aria-label",
      "Usuários do sistema",
    );
  });
});

describe("UserManagementClient — ações destrutivas acessíveis", () => {
  it("botão Desativar tem rótulo textual visível e aria-label", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    // Deve haver botões "Desativar" com texto visível (não só ícone)
    const deactivateButtons = screen.getAllByRole("button", {
      name: /Desativar/,
    });
    expect(deactivateButtons.length).toBeGreaterThan(0);

    // Cada botão deve ter aria-label com o nome do usuário
    for (const btn of deactivateButtons) {
      expect(btn).toHaveAttribute("aria-label");
      expect(btn.getAttribute("aria-label")).toMatch(/Desativar .+/);
      // E deve ter texto visível (não apenas ícone)
      expect(btn.textContent).toMatch(/Desativar/);
    }
  });

  it("botão Reativar tem rótulo textual visível e aria-label", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    const reactivateBtn = screen.getByRole("button", {
      name: /Reativar João Pedro Santos/,
    });
    expect(reactivateBtn).toBeInTheDocument();
    expect(reactivateBtn.textContent).toMatch(/Reativar/);
  });

  it("botão Revogar tem rótulo textual visível e aria-label", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    const revokeBtn = screen.getByRole("button", {
      name: /Revogar convite de paula\.mendes@exemplo\.com/,
    });
    expect(revokeBtn).toBeInTheDocument();
    expect(revokeBtn.textContent).toMatch(/Revogar/);
  });

  it("ConfirmDialog de desativação diz claramente o que vai acontecer e com quem", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    // Clica no botão Desativar do Rafael
    const deactivateBtn = screen.getByRole("button", {
      name: /Desativar Rafael Almeida/,
    });
    fireEvent.click(deactivateBtn);

    // Dialog deve aparecer com nome e consequência
    expect(screen.getByText("Desativar usuário")).toBeInTheDocument();
    // Nome aparece na tabela e no dialog — usar getAllByText
    expect(
      screen.getAllByText(/Rafael Almeida/).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/não poderá fazer login até ser reativado/),
    ).toBeInTheDocument();
  });

  it("ConfirmDialog de revogação diz claramente o que vai acontecer e com quem", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    const revokeBtn = screen.getByRole("button", {
      name: /Revogar convite de paula\.mendes@exemplo\.com/,
    });
    fireEvent.click(revokeBtn);

    expect(screen.getByText("Revogar convite")).toBeInTheDocument();
    // E-mail aparece na tabela e no dialog — usar getAllByText
    expect(
      screen.getAllByText(/paula\.mendes@exemplo\.com/).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/não poderá mais se cadastrar/),
    ).toBeInTheDocument();
  });

  it("nenhuma ação destrutiva é apenas um ícone sem texto", () => {
    render(
      <UserManagementClient
        users={sampleUsers}
        currentUserId="u99"
        roleLabels={roleLabels}
      />,
    );

    // Todos os botões destrutivos devem ter texto visível
    const destructiveButtons = screen
      .getAllByRole("button")
      .filter(
        (btn) =>
          btn.textContent?.match(/Desativar|Revogar/) &&
          btn.getAttribute("aria-label"),
      );

    // Deve haver pelo menos 3 (2 desativar + 1 revogar)
    expect(destructiveButtons.length).toBeGreaterThanOrEqual(3);

    for (const btn of destructiveButtons) {
      // Não pode ser vazio ou só espaços
      expect(btn.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});
