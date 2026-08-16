// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "@/components/confirm-dialog";

afterEach(cleanup);

describe("ConfirmDialog", () => {
  it("aberto: mostra título, descrição e ações", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Excluir vaga"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        tone="destructive"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("Excluir vaga")).toBeInTheDocument();
    expect(
      screen.getByText("Esta ação não pode ser desfeita."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Excluir" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
  });

  it("fechado: não renderiza conteúdo", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Excluir vaga"
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText("Excluir vaga")).not.toBeInTheDocument();
  });

  it("confirmação destrutiva expõe aria-label com o rótulo da ação", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Desativar usuário"
        confirmLabel="Desativar usuário"
        tone="destructive"
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Desativar usuário" }),
    ).toHaveAttribute("aria-label", "Desativar usuário");
  });

  it("dispara onConfirm ao confirmar e onOpenChange(false) ao cancelar", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Confirmar"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("pending desabilita as ações", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Confirmar"
        pending
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Aguarde..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });
});
