import * as React from "react";
import { SendIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marca unificada das telas públicas (landing, login, auth-error, forbidden).
 * Padrão medido do protótipo aprovado: ícone âmbar + "ILLT - Escala" com
 * subtítulo "Amazon DSP Manager".
 */
export function AuthBrand({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={cn("text-center", className)}>
      <span className="inline-flex items-center gap-2 text-[22px] font-bold leading-7 text-heading">
        <SendIcon className={cn("size-[22px] text-brand", iconClassName)} />
        ILLT - Escala
      </span>
      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
        Amazon DSP Manager
      </span>
    </div>
  );
}
