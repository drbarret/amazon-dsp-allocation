import { auth, signOut } from "@/lib/auth";
import { needsOnboarding } from "@/lib/onboarding";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogOutIcon, UserIcon } from "lucide-react";
import Link from "next/link";

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
    ADMIN: "Administrador",
    ACCOUNT_MANAGER: "Gerente de Contas",
    SUPERVISOR: "Supervisor",
    DRIVER: "Motorista",
  };

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
      </header>

      {/* Main content */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
