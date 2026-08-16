"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type WeekOption = {
  id: string;
  weekKey: string;
  startDate: string;
  endDate: string;
};

/**
 * Seletor de semana — controle primário das telas operacionais.
 * Select nativo estilizado (robusto, acessível e testável).
 */
export function WeekSelector({
  weeks,
  value,
  onChange,
  disabled = false,
  label = "Semana",
  className,
}: {
  weeks: WeekOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const selectId = React.useId();

  if (weeks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nenhuma semana cadastrada</p>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 max-sm:w-full", className)}>
      <label
        htmlFor={selectId}
        className="text-sm font-medium text-foreground"
      >
        {label}
      </label>
      <select
        id={selectId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-24 flex-1 rounded-lg border border-border bg-card px-3 py-1 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
      >
        {weeks.map((w) => (
          <option key={w.id} value={w.id}>
            {w.weekKey} · {w.startDate} – {w.endDate}
          </option>
        ))}
      </select>
    </div>
  );
}
