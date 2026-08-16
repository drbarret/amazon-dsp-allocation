import * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  success: "bg-success-bg text-success-fg border-success-border",
  info: "bg-info-bg text-info-fg border-info-border",
  warning: "bg-warning-bg text-warning-fg border-warning-border",
  neutral: "bg-neutral-bg text-neutral-fg border-neutral-border",
  purple: "bg-purple-bg text-purple-fg border-purple-border",
  danger: "bg-danger-bg text-danger-fg border-danger-border",
} as const;

export type StatusPillTone = keyof typeof tones;

/**
 * Pílula de status semântica com os pares texto/fundo/borda medidos
 * da referência (todos passam em WCAG AA para texto normal).
 */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusPillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs leading-4 font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
