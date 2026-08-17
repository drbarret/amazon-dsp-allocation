"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  /** Rótulo do cabeçalho */
  header: React.ReactNode;
  /** Renderizador da célula para a linha */
  cell: (row: T, index: number) => React.ReactNode;
  /** Classes extras no th/td (ex.: alinhamento, tabular-nums) */
  className?: string;
  /** Fixa a coluna à esquerda no scroll horizontal (mobile) */
  sticky?: boolean;
};

/**
 * Tabela de dados operacional com os três estados reais:
 * - loading: skeleton de linhas pulsantes (nunca mostra "vazio" durante carga)
 * - empty: EmptyState com título/dica/ação
 * - ready: linhas
 *
 * Encapsula o padrão `overflow-x-auto rounded-lg border bg-white`
 * repetido hoje em 6 telas.
 */
export function DataTable<T>({
  columns,
  rows,
  loading = false,
  empty,
  dense = false,
  skeletonRows = 5,
  ariaLabel,
  className,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  loading?: boolean;
  empty: {
    icon?: LucideIcon;
    title: string;
    hint?: string;
    action?: { label: string; onClick: () => void };
  };
  dense?: boolean;
  skeletonRows?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const isEmpty = !loading && rows.length === 0;

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <table
        aria-label={ariaLabel}
        className="w-full border-collapse text-sm leading-5"
      >
        <thead>
          <tr className="border-b border-border">
            {columns.map((col, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground first:pl-6 last:pr-6",
                  col.sticky && "sticky left-0 z-10 bg-card",
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, rowIdx) => (
              <tr
                key={rowIdx}
                data-testid="datatable-skeleton-row"
                className="border-b border-border last:border-b-0"
              >
                {columns.map((_, colIdx) => (
                  <td
                    key={colIdx}
                    className="px-2 py-3 first:pl-6 last:pr-6"
                  >
                    <span className="block h-3 w-4/5 animate-pulse rounded-md bg-border" />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-b border-border last:border-b-0 hover:bg-neutral-bg/50"
              >
                {columns.map((col, colIdx) => (
                  <td
                    key={colIdx}
                    className={cn(
                      "align-middle first:pl-6 last:pr-6",
                      dense ? "px-2 py-2" : "px-2 py-3",
                      col.sticky && "sticky left-0 z-10 bg-card",
                      col.className,
                    )}
                  >
                    {col.cell(row, rowIdx)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {/*
        Empty state renders OUTSIDE the <table> (but inside the card): inside
        a <td colSpan> it inherited the table's scrollable width — headers
        are whitespace-nowrap — and its text was clipped at the viewport edge
        on narrow screens (audited: "seman", "aqu" cut off at 390px). As a
        plain block sibling it lays out at the card's visible width.
      */}
      {isEmpty ? (
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          hint={empty.hint}
          action={empty.action}
        />
      ) : null}
    </div>
  );
}
