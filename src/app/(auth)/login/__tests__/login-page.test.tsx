// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const mockSignIn = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
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

const { LoginForm } = await import("@/app/(auth)/login/login-form");

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

function switchToEmailTab() {
  fireEvent.click(screen.getByRole("button", { name: /^E-mail$/i }));
}

function submitEmailForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("Form not found");
  fireEvent.submit(form);
}

describe("LoginForm", () => {
  it("renderiza os dois caminhos de login (Amazon e E-mail)", () => {
    render(<LoginForm />);

    expect(screen.getByRole("button", { name: /^Amazon$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^E-mail$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Entrar com Amazon/i })
    ).toBeInTheDocument();
  });

  it("alterna para o formulário de e-mail ao clicar na aba E-mail", () => {
    render(<LoginForm />);

    switchToEmailTab();

    expect(
      screen.getByRole("button", { name: /Receber link de acesso/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/E-mail/i)).toBeInTheDocument();
  });

  it("chama signIn('resend', { email, redirect: false }) com e-mail válido", async () => {
    mockSignIn.mockResolvedValue({ ok: true });

    render(<LoginForm />);

    switchToEmailTab();
    fireEvent.change(screen.getByLabelText(/E-mail/i), {
      target: { value: "admin@instalog.com.br" },
    });
    submitEmailForm();

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("resend", {
        email: "admin@instalog.com.br",
        redirect: false,
      });
    });

    expect(
      screen.getByText(/Verifique sua caixa de entrada/i)
    ).toBeInTheDocument();
  });

  it("mostra erro de validação quando o e-mail é inválido", () => {
    render(<LoginForm />);

    switchToEmailTab();
    fireEvent.change(screen.getByLabelText(/E-mail/i), {
      target: { value: "email-invalido" },
    });
    submitEmailForm();

    expect(screen.getByText(/Digite um e-mail válido/i)).toBeInTheDocument();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("mostra erro quando signIn resend retorna falha", async () => {
    mockSignIn.mockResolvedValue({ ok: false, error: "unauthorized" });

    render(<LoginForm />);

    switchToEmailTab();
    fireEvent.change(screen.getByLabelText(/E-mail/i), {
      target: { value: "admin@instalog.com.br" },
    });
    submitEmailForm();

    expect(
      await screen.findByText(
        /Não foi possível enviar o link. Verifique o e-mail e tente novamente./i
      )
    ).toBeInTheDocument();
  });
});
