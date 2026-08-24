// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";

// Mock do usePathname do Next — controla a "rota atual" de cada teste.
const mockPathname = vi.fn(() => "/dashboard");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

afterEach(cleanup);
beforeEach(() => {
  mockPathname.mockReturnValue("/dashboard");
});

// Itens com as flags já resolvidas — o layout (server) aplica roleIsAtLeast;
// aqui testamos que o componente respeita fielmente o `show` recebido.
const allItems: NavItem[] = [
  { href: "/dashboard", label: "Início", show: true },
  { href: "/disponibilidades", label: "Disponibilidades", show: true },
  { href: "/drivers", label: "Motoristas", show: true },
  { href: "/cnh", label: "Cobrar CNH", show: true },
  { href: "/admin/users", label: "Usuários", show: true },
];

const driverItems: NavItem[] = allItems.map((i) =>
  i.href === "/dashboard" ? i : { ...i, show: false },
);

const supervisorItems: NavItem[] = allItems.map((i) =>
  i.href === "/admin/users" ? { ...i, show: false } : i,
);

function renderSidebar(items: NavItem[]) {
  return render(
    <AppSidebar
      items={items}
      userName="Maria Silva"
      userRoleLabel="Supervisor"
      signOutAction={async () => {}}
    />,
  );
}

describe("AppSidebar — item ativo", () => {
  it("a rota atual recebe aria-current=\"page\" e as demais não", () => {
    mockPathname.mockReturnValue("/disponibilidades");
    renderSidebar(allItems);
    const disponibilidades = screen.getAllByRole("link", { name: /Disponibilidades/ })[0];
    expect(disponibilidades).toHaveAttribute("aria-current", "page");
    const inicio = screen.getAllByRole("link", { name: /Início/ })[0];
    expect(inicio).not.toHaveAttribute("aria-current");
  });

  it("sub-rota também marca o item pai (ex.: /admin/users/123)", () => {
    mockPathname.mockReturnValue("/admin/users/123");
    renderSidebar(allItems);
    const usuarios = screen.getAllByRole("link", { name: /Usuários/ })[0];
    expect(usuarios).toHaveAttribute("aria-current", "page");
  });

  it("a navegação tem aria-label para leitores de tela", () => {
    renderSidebar(allItems);
    expect(
      screen.getByRole("navigation", { name: "Navegação principal" }),
    ).toBeInTheDocument();
  });
});

describe("AppSidebar — itens por papel", () => {
  it("DRIVER vê apenas Início", () => {
    renderSidebar(driverItems);
    expect(screen.getAllByRole("link", { name: /Início/ })).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Disponibilidades/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Comportamento/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Motoristas/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Cobrar CNH/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Usuários/ })).toBeNull();
  });

  it("SUPERVISOR vê as 4 telas operacionais, mas não Usuários", () => {
    renderSidebar(supervisorItems);
    expect(screen.getAllByRole("link", { name: /Início/ })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Disponibilidades/ })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Motoristas/ })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Cobrar CNH/ })).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Usuários/ })).toBeNull();
  });

  it("ADMIN/ACCOUNT_MANAGER veem todos os 5 itens", () => {
    renderSidebar(allItems);
    for (const label of [
      "Início",
      "Disponibilidades",
      "Motoristas",
      "Cobrar CNH",
      "Usuários",
    ]) {
      expect(
        screen.getAllByRole("link", { name: new RegExp(label) }),
      ).not.toHaveLength(0);
    }
  });
});

describe("AppSidebar — gaveta mobile", () => {
  it("hambúrguer abre a gaveta e o botão fechar a fecha", () => {
    renderSidebar(allItems);
    // gaveta fechada: só a sidebar desktop existe (1 nav)
    expect(
      screen.getAllByRole("navigation", { name: "Navegação principal" }),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Abrir menu de navegação" }),
    );
    // gaveta aberta: sidebar + gaveta (2 navs) e o diálogo modal
    expect(
      screen.getAllByRole("navigation", { name: "Navegação principal" }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("dialog", { name: "Menu de navegação" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Fechar menu de navegação" }),
    );
    expect(
      screen.getAllByRole("navigation", { name: "Navegação principal" }),
    ).toHaveLength(1);
  });

  it("clicar num link da gaveta a fecha", () => {
    renderSidebar(allItems);
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir menu de navegação" }),
    );
    expect(
      screen.getAllByRole("navigation", { name: "Navegação principal" }),
    ).toHaveLength(2);

    // o segundo link "Motoristas" é o da gaveta
    const motoristas = screen.getAllByRole("link", { name: /Motoristas/ });
    fireEvent.click(motoristas[motoristas.length - 1]);
    expect(
      screen.getAllByRole("navigation", { name: "Navegação principal" }),
    ).toHaveLength(1);
  });

  it("mudança de rota fecha a gaveta", () => {
    const { rerender } = render(
      <AppSidebar
        items={allItems}
        userName="Maria"
        userRoleLabel="Supervisor"
        signOutAction={async () => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir menu de navegação" }),
    );
    expect(
      screen.getAllByRole("navigation", { name: "Navegação principal" }),
    ).toHaveLength(2);

    mockPathname.mockReturnValue("/drivers");
    rerender(
      <AppSidebar
        items={allItems}
        userName="Maria"
        userRoleLabel="Supervisor"
        signOutAction={async () => {}}
      />,
    );
    expect(
      screen.getAllByRole("navigation", { name: "Navegação principal" }),
    ).toHaveLength(1);
  });
});
