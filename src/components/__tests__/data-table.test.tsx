// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "@/components/data-table";

afterEach(cleanup);

type Row = { id: string; name: string; qty: number };

const columns: DataTableColumn<Row>[] = [
  { header: "Nome", cell: (r) => r.name },
  { header: "Qtd", cell: (r) => r.qty, className: "tabular-nums" },
];

const rows: Row[] = [
  { id: "1", name: "Ana", qty: 3 },
  { id: "2", name: "Beto", qty: 5 },
];

describe("DataTable", () => {
  it("ready: renderiza cabeçalhos e linhas", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        empty={{ title: "Nenhuma linha" }}
      />,
    );
    expect(screen.getByText("Nome")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Beto")).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma linha")).not.toBeInTheDocument();
  });

  it("loading: mostra skeleton e NUNCA o estado vazio (bug do falso vazio)", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        loading
        empty={{ title: "Nenhuma infração registrada" }}
      />,
    );
    expect(
      screen.getAllByTestId("datatable-skeleton-row").length,
    ).toBeGreaterThan(0);
    // A asserção central: durante a carga, o "vazio" não pode aparecer.
    expect(
      screen.queryByText("Nenhuma infração registrada"),
    ).not.toBeInTheDocument();
  });

  it("empty: sem linhas e sem loading mostra o EmptyState com ação", () => {
    const onClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[]}
        empty={{
          title: "Nenhuma vaga cadastrada",
          hint: "Crie a primeira vaga da semana.",
          action: { label: "Nova Vaga", onClick },
        }}
      />,
    );
    expect(screen.getByText("Nenhuma vaga cadastrada")).toBeInTheDocument();
    expect(
      screen.getByText("Crie a primeira vaga da semana."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nova Vaga" }),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByTestId("datatable-skeleton-row"),
    ).toHaveLength(0);
  });

  it("expõe aria-label na tabela quando informado", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        ariaLabel="Vagas da semana"
        empty={{ title: "vazio" }}
      />,
    );
    expect(screen.getByRole("table")).toHaveAttribute(
      "aria-label",
      "Vagas da semana",
    );
  });
});
