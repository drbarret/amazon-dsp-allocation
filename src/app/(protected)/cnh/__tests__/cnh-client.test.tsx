// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks: a server action collectCnh é mockada para nunca enviar e-mail real.
// O toast também é mockado para capturar o texto exibido ao usuário.
// ---------------------------------------------------------------------------

vi.mock("../actions", () => ({
  collectCnh: vi.fn().mockResolvedValue({
    success: true,
    sent: 0,
    degraded: 0,
    failed: [],
    rejected: [],
  }),
}));

const mockToastWarning = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => mockToastWarning(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}));

import { CnhCollectionClient, type ExpiredCnhRow } from "../client";

afterEach(cleanup);

const sampleDrivers: ExpiredCnhRow[] = [
  {
    driverProfileId: "dp1",
    userId: "u1",
    name: "Beatriz Nogueira",
    email: "beatriz.nogueira@exemplo.com",
    cnhExpiration: "2026-03-15T00:00:00.000Z",
    lastCollectedAt: "2026-08-02T10:30:00.000Z",
  },
  {
    driverProfileId: "dp2",
    userId: "u2",
    name: "João Pedro Santos",
    email: "joao.santos@exemplo.com",
    cnhExpiration: "2025-05-20T00:00:00.000Z",
    lastCollectedAt: null,
  },
  {
    driverProfileId: "dp3",
    userId: "u3",
    name: "Ricardo Tavares",
    email: "ricardo.tavares@exemplo.com",
    cnhExpiration: "2026-07-01T00:00:00.000Z",
    lastCollectedAt: "2026-08-10T14:00:00.000Z",
  },
];

describe("CnhCollectionClient — render", () => {
  it("com dados: mostra cabeçalho, tabela e botão de cobrança", () => {
    render(
      <CnhCollectionClient drivers={sampleDrivers} currentUserId="u99" />,
    );

    expect(screen.getByText("Cobrar CNH")).toBeInTheDocument();
    expect(screen.getByText("Beatriz Nogueira")).toBeInTheDocument();
    expect(screen.getByText("João Pedro Santos")).toBeInTheDocument();
    expect(screen.getByText("Ricardo Tavares")).toBeInTheDocument();

    // E-mails como linha secundária
    expect(
      screen.getByText("beatriz.nogueira@exemplo.com"),
    ).toBeInTheDocument();

    // Última cobrança formatada
    expect(screen.getByText("Nunca cobrado")).toBeInTheDocument();

    // Botão desabilitado sem seleção
    const btn = screen.getByRole("button", { name: /Enviar cobrança/ });
    expect(btn).toBeDisabled();
  });

  it("vazio: sem motoristas mostra EmptyState", () => {
    render(<CnhCollectionClient drivers={[]} currentUserId="u99" />);

    expect(
      screen.getByText("Nenhum motorista com CNH vencida"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Quando a CNH de um motorista ativo vencer, ele aparecerá aqui para cobrança.",
      ),
    ).toBeInTheDocument();
  });

  it("seleção atualiza o botão com a contagem", () => {
    render(
      <CnhCollectionClient drivers={sampleDrivers} currentUserId="u99" />,
    );

    // Seleciona o primeiro motorista
    const checkbox = screen.getByLabelText("Selecionar Beatriz Nogueira");
    fireEvent.click(checkbox);

    const btn = screen.getByRole("button", { name: /Enviar cobrança/ });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent("1 selecionado");
  });

  it("selecionar todos marca todos os checkboxes", () => {
    render(
      <CnhCollectionClient drivers={sampleDrivers} currentUserId="u99" />,
    );

    const selectAll = screen.getByLabelText("Selecionar todos");
    fireEvent.click(selectAll);

    const btn = screen.getByRole("button", { name: /Enviar cobrança/ });
    expect(btn).toHaveTextContent("3 selecionados");
  });

  it("botão abre ConfirmDialog com contagem e nomes antes de enviar", () => {
    render(
      <CnhCollectionClient drivers={sampleDrivers} currentUserId="u99" />,
    );

    // Seleciona dois motoristas
    fireEvent.click(screen.getByLabelText("Selecionar Beatriz Nogueira"));
    fireEvent.click(screen.getByLabelText("Selecionar João Pedro Santos"));

    // Clica no botão de enviar
    fireEvent.click(screen.getByRole("button", { name: /Enviar cobrança/ }));

    // ConfirmDialog deve aparecer com contagem e nomes
    expect(screen.getByText("Enviar cobrança de CNH")).toBeInTheDocument();
    // Os nomes aparecem tanto na tabela quanto no dialog — usar getAllByText
    expect(
      screen.getAllByText(/Beatriz Nogueira/).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByText(/João Pedro Santos/).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("button", { name: /Enviar para 2 motoristas/ }),
    ).toBeInTheDocument();
  });

  it("tabela tem aria-label para leitores de tela", () => {
    render(
      <CnhCollectionClient drivers={sampleDrivers} currentUserId="u99" />,
    );
    expect(screen.getByRole("table")).toHaveAttribute(
      "aria-label",
      "Motoristas com CNH vencida",
    );
  });

  it("cada motorista tem checkbox com aria-label acessível", () => {
    render(
      <CnhCollectionClient drivers={sampleDrivers} currentUserId="u99" />,
    );
    expect(
      screen.getByLabelText("Selecionar Beatriz Nogueira"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Selecionar João Pedro Santos"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Selecionar Ricardo Tavares"),
    ).toBeInTheDocument();
  });
});

describe("CnhCollectionClient — resumo pós-envio", () => {
  it("resumo padronizado mostra enviados, degradados e falhas sem vazar env var", async () => {
    const { collectCnh } = await import("../actions");
    (collectCnh as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      sent: 1,
      degraded: 1,
      failed: [{ name: "Amanda Freitas", reason: "Falha ao enviar e-mail." }],
      rejected: [{ name: "Carlos Lima", reason: "CNH não está vencida." }],
    });

    render(
      <CnhCollectionClient drivers={sampleDrivers} currentUserId="u99" />,
    );

    // Seleciona todos e envia
    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    fireEvent.click(screen.getByRole("button", { name: /Enviar cobrança/ }));

    // Confirma no dialog
    fireEvent.click(
      screen.getByRole("button", { name: /Enviar para 3 motoristas/ }),
    );

    // Aguarda o resumo aparecer
    const summary = await screen.findByText("Resumo do envio");
    expect(summary).toBeInTheDocument();

    // Verifica as categorias
    expect(screen.getByText("Enviado")).toBeInTheDocument();
    expect(screen.getByText("Ambiente")).toBeInTheDocument();
    expect(screen.getByText("Falha")).toBeInTheDocument();
    expect(screen.getByText("Não enviado")).toBeInTheDocument();

    // NÃO pode conter nome de variável de ambiente
    const summaryText = screen.getByText("Resumo do envio").closest("div")!
      .textContent!;
    expect(summaryText).not.toMatch(/RESEND_API_KEY/i);
    expect(summaryText).not.toMatch(/API_KEY/i);
    expect(summaryText).not.toMatch(/process\.env/i);
  });

  it("toast de degradado NÃO expõe nome de variável de ambiente", async () => {
    const { collectCnh } = await import("../actions");
    (collectCnh as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      sent: 0,
      degraded: 2,
      failed: [],
      rejected: [],
    });

    render(
      <CnhCollectionClient drivers={sampleDrivers} currentUserId="u99" />,
    );

    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    fireEvent.click(screen.getByRole("button", { name: /Enviar cobrança/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Enviar para 3 motoristas/ }),
    );

    // Aguarda o toast ser chamado
    await vi.waitFor(() => {
      expect(mockToastWarning).toHaveBeenCalled();
    });

    const toastText = mockToastWarning.mock.calls[0][0] as string;
    expect(toastText).not.toMatch(/RESEND_API_KEY/i);
    expect(toastText).not.toMatch(/API_KEY/i);
    expect(toastText).not.toMatch(/process\.env/i);
    expect(toastText).toMatch(/e-mail não configurado/i);
  });
});
