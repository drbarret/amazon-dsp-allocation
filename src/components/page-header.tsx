import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho de página padronizado (título + descrição + ações à direita).
 * Medido da referência: título 24px/700 slate-900, descrição 14px slate-500.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-heading">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full [&>*]:max-sm:flex-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
