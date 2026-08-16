"use client";

import * as React from "react";
import { LogOutIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Menu de usuário no rodapé da sidebar: avatar com iniciais,
 * nome, papel e ação "Sair" em dropdown.
 */
export function UserMenu({
  name,
  roleLabel,
  onSignOut,
  className,
}: {
  name: string;
  roleLabel: string;
  onSignOut: () => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 bottom-[calc(100%+6px)] left-0 z-50 rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-danger-fg outline-none hover:bg-danger-bg focus-visible:bg-danger-bg"
          >
            <LogOutIcon className="size-4" />
            Sair
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu de ${name}`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 px-2.5 py-2 text-sidebar-fg outline-none transition-colors hover:bg-sidebar-item-hover-bg focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] leading-4 font-medium">
            {name}
          </span>
          <span className="block text-[11px] leading-4 text-sidebar-sub">
            {roleLabel}
          </span>
        </span>
        <ChevronUpIcon
          className={cn(
            "size-4 shrink-0 text-sidebar-sub transition-transform",
            !open && "rotate-180",
          )}
        />
      </button>
    </div>
  );
}
