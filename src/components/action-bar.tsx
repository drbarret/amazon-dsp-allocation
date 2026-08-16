import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Faixa que agrupa as ações principais da tela/semana.
 * Alinhada à direita no desktop; botões full-width empilhados no mobile.
 */
export function ActionBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-end gap-2 max-sm:flex-col max-sm:items-stretch max-sm:[&>*]:w-full",
        className,
      )}
    >
      {children}
    </div>
  );
}
