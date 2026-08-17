import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { InboxIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Estado vazio padronizado: ícone, título, dica do próximo passo
 * e ação opcional. Substitui os <td> cinzas improvisados.
 */
export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-neutral-bg text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {hint ? (
        <p className="max-w-md text-[13px] leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {action ? (
        <Button className="mt-2" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
