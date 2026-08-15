import { auth, signOut } from "@/lib/auth";
import { needsOnboarding } from "@/lib/onboarding";
import { redirect } from "next/navigation";
import { roleIsAtLeast } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { LogOutIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import type { UserRole } from "@/generated/prisma";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  if (session.user.active === false) {
    redirect("/login?error=deactivated");
  }

  // Onboarding gate: DRIVER without completed profile → onboarding
  const requiresOnboarding = await needsOnboarding(session.user.id);
  if (requiresOnboarding) {
    redirect("/onboarding");
  }

  const roleLabel: Record<string, string> = {
    ACCOUNT_MANAGER: "Gerente de Contas",
    SUPERVISOR: "Supervisor",
    DRIVER: "Motorista",
  };

  const role = (session.user.role ?? "DRIVER") as UserRole;
  const navItems: { href: string; label: string; show: boolean }[] = [
    { href: "/dashboard", label: "Início", show: true },
    { href: "/dispatch", label: "Dispatch", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/behavior", label: "Comportamento", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/drivers", label: "Motoristas", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/cnh", label: "Cobrar CNH", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/admin/users", label: "Usuários", show: roleIsAtLeast(role, "ACCOUNT_MANAGER") },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-zinc-900">
              Amazon DSP
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end sm:flex">
              <span className="text-sm font-medium text-zinc-700">
                {session.user.name ?? "Usuário"}
              </span>
              <span className="text-xs text-zinc-500">
                {roleLabel[session.user.role ?? "DRIVER"] ?? session.user.role}
              </span>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 sm:hidden">
              <UserIcon className="size-4 text-zinc-500" />
            </div>

            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button type="submit" variant="ghost" size="sm">
                <LogOutIcon className="size-4" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </form>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex gap-1 overflow-x-auto border-t px-4 py-1.5">
          {navItems
            .filter((n) => n.show)
            .map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              >
                {n.label}
              </Link>
            ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
