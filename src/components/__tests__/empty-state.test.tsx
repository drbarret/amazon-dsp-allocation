// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EmptyState } from "@/components/empty-state";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renderiza título e dica", () => {
    render(
      <EmptyState
        title="Nenhuma vaga cadastrada"
        hint='Use o botão "Nova Vaga" para começar.'
      />,
    );
    expect(screen.getByText("Nenhuma vaga cadastrada")).toBeInTheDocument();
    expect(
      screen.getByText('Use o botão "Nova Vaga" para começar.'),
    ).toBeInTheDocument();
  });

  it("renderiza ação e dispara onClick", () => {
    const onClick = vi.fn();
    render(
      <EmptyState title="Vazio" action={{ label: "Nova Vaga", onClick }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nova Vaga" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("omite ação quando não informada", () => {
    render(<EmptyState title="Vazio" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
