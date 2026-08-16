import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const valueTones = {
  default: "",
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
} as const;

/**
 * Cartão de KPI no padrão medido da referência: rótulo pequeno,
 * valor grande tabular-nums, legenda de contexto opcional.
 */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  loading = false,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: keyof typeof valueTones;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card px-6 py-5 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm leading-5 text-card-foreground">{label}</span>
        {Icon ? <Icon className="size-4 shrink-0 text-info-fg" /> : null}
      </div>
      {loading ? (
        <>
          <span
            data-testid="kpi-skeleton"
            className="h-9 w-24 animate-pulse rounded-md bg-border"
          />
          <span className="h-4 w-32 animate-pulse rounded-md bg-border" />
        </>
      ) : (
        <>
          <span
            className={cn(
              "text-3xl leading-9 font-bold tracking-tight tabular-nums",
              valueTones[tone],
            )}
          >
            {value}
          </span>
          {hint ? (
            <span className="text-xs leading-4 text-muted-foreground">
              {hint}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
