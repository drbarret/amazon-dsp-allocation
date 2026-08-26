import { auth, signOut } from "@/lib/auth";
import { needsOnboarding } from "@/lib/onboarding";
import { redirect } from "next/navigation";
import { roleIsAtLeast } from "@/lib/authz";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
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
  // Regras de exibição por papel — idênticas às anteriores, item por item.
  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Início", show: true },
    { href: "/disponibilidades", label: "Disponibilidades", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/vagas", label: "Vagas", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/drivers", label: "Motoristas", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/performance", label: "Performance", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/cnh", label: "Cobrar CNH", show: roleIsAtLeast(role, "SUPERVISOR") },
    { href: "/admin/users", label: "Usuários", show: roleIsAtLeast(role, "ACCOUNT_MANAGER") },
  ];

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-page lg:flex-row">
      <AppSidebar
        items={navItems}
        userName={session.user.name ?? "Usuário"}
        userRoleLabel={roleLabel[session.user.role ?? "DRIVER"] ?? session.user.role ?? "Motorista"}
        signOutAction={signOutAction}
      />
      {/* Main content */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
