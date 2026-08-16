// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { UserMenu } from "@/components/user-menu";

afterEach(cleanup);

describe("UserMenu", () => {
  it("mostra iniciais, nome e papel", () => {
    render(
      <UserMenu name="Maria Silva" roleLabel="Supervisor" onSignOut={() => {}} />,
    );
    expect(screen.getByText("MS")).toBeInTheDocument();
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("Supervisor")).toBeInTheDocument();
  });

  it("abre o dropdown e dispara onSignOut no item Sair", () => {
    const onSignOut = vi.fn();
    render(
      <UserMenu name="Maria Silva" roleLabel="Supervisor" onSignOut={onSignOut} />,
    );
    const trigger = screen.getByRole("button", { name: "Menu de Maria Silva" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const sair = screen.getByRole("menuitem", { name: /Sair/ });
    fireEvent.click(sair);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("fecha o dropdown com Escape", () => {
    render(
      <UserMenu name="João" roleLabel="Motorista" onSignOut={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menu de João" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
