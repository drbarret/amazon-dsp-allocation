// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PageHeader } from "@/components/page-header";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renderiza título e descrição", () => {
    render(<PageHeader title="Dispatch" description="Vagas da semana" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Dispatch" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Vagas da semana")).toBeInTheDocument();
  });

  it("omite descrição quando não informada", () => {
    render(<PageHeader title="Motoristas" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Motoristas" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Vagas da semana")).not.toBeInTheDocument();
  });

  it("renderiza ações à direita", () => {
    render(
      <PageHeader title="Dispatch" actions={<button>Nova Vaga</button>} />,
    );
    expect(
      screen.getByRole("button", { name: "Nova Vaga" }),
    ).toBeInTheDocument();
  });
});
