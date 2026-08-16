"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClockIcon,
  ClipboardListIcon,
  GaugeIcon,
  IdCardIcon,
  MenuIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  show: boolean;
};

const navIcons: Record<string, LucideIcon> = {
  "/dashboard": GaugeIcon,
  "/dispatch": CalendarClockIcon,
  "/behavior": ClipboardListIcon,
  "/drivers": UsersIcon,
  "/cnh": IdCardIcon,
  "/admin/users": UsersIcon,
};

function BrandBlock() {
  return (
    <div className="border-b border-white/10 px-4 pt-5 pb-4">
      <Link
        href="/dashboard"
        className="flex items-center gap-2 text-lg leading-7 font-bold text-sidebar-fg outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md"
      >
        <CalendarClockIcon className="size-5 text-brand" />
        Amazon DSP
      </Link>
      <p className="mt-0.5 text-xs leading-4 text-sidebar-sub">
        Escala e alocação de motoristas
      </p>
    </div>
  );
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Navegação principal" className="flex-1 p-4">
      <ul className="flex flex-col gap-1">
        {items
          .filter((n) => n.show)
          .map((n) => {
            const isActive =
              pathname === n.href || pathname.startsWith(n.href + "/");
            const Icon = navIcons[n.href] ?? GaugeIcon;
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-lg px-4 text-sm leading-5 font-medium text-sidebar-item transition-colors outline-none hover:bg-sidebar-item-hover-bg hover:text-sidebar-fg focus-visible:ring-2 focus-visible:ring-brand",
                    isActive && "bg-brand text-brand-foreground hover:bg-brand hover:text-brand-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {n.label}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}

/**
 * Sidebar escura fixa (desktop) + gaveta (mobile), com item ativo
 * marcado via usePathname + aria-current="page".
 */
export function AppSidebar({
  items,
  userName,
  userRoleLabel,
  signOutAction,
}: {
  items: NavItem[];
  userName: string;
  userRoleLabel: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [prevPathname, setPrevPathname] = React.useState(pathname);

  // Fecha a gaveta ao navegar (padrão "adjust state during render" do React,
  // evita setState em effect). Links da gaveta também fecham via onNavigate.
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setDrawerOpen(false);
  }

  // Trava o scroll do body com a gaveta aberta
  React.useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [drawerOpen]);

  const handleSignOut = () => {
    void signOutAction();
  };

  return (
    <>
      {/* Barra superior mobile */}
      <div className="sticky top-0 z-40 flex items-center gap-3 bg-sidebar-bg px-4 py-2.5 text-sidebar-fg lg:hidden">
        <button
          type="button"
          aria-label="Abrir menu de navegação"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
          className="flex size-9 items-center justify-center rounded-lg border border-white/20 outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <MenuIcon className="size-5" />
        </button>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-base font-bold outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md"
        >
          <CalendarClockIcon className="size-5 text-brand" />
          Amazon DSP
        </Link>
      </div>

      {/* Sidebar fixa desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar-bg text-sidebar-fg lg:flex">
        <BrandBlock />
        <NavLinks items={items} pathname={pathname} />
        <div className="px-4 pb-3">
          <UserMenu
            name={userName}
            roleLabel={userRoleLabel}
            onSignOut={handleSignOut}
          />
        </div>
      </aside>

      {/* Gaveta mobile */}
      {drawerOpen ? (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-black/50"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar-bg text-sidebar-fg"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 pt-5 pb-4">
              <span className="flex items-center gap-2 text-lg font-bold">
                <CalendarClockIcon className="size-5 text-brand" />
                Amazon DSP
              </span>
              <button
                type="button"
                aria-label="Fechar menu de navegação"
                onClick={() => setDrawerOpen(false)}
                className="flex size-9 items-center justify-center rounded-lg text-sidebar-item outline-none hover:bg-sidebar-item-hover-bg focus-visible:ring-2 focus-visible:ring-brand"
              >
                <XIcon className="size-5" />
              </button>
            </div>
            <NavLinks
              items={items}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
            <div className="px-4 pb-4">
              <UserMenu
                name={userName}
                roleLabel={userRoleLabel}
                onSignOut={handleSignOut}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
