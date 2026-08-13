import { auth } from "@/lib/auth";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TruckIcon, ClockIcon } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  ACCOUNT_MANAGER: "Gerente de Contas",
  SUPERVISOR: "Supervisor",
  DRIVER: "Motorista",
};

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Olá, {session?.user?.name ?? "Usuário"}!
        </h1>
        <p className="text-sm text-zinc-500">
          {ROLE_LABELS[session?.user?.role ?? "DRIVER"] ?? session?.user?.role}
        </p>
      </div>

      {/* Confirmation card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TruckIcon className="size-5 text-green-600" />
            Cadastro concluído
          </CardTitle>
          <CardDescription>
            Seu perfil de motorista está completo e você está pronto para
            receber alocações.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Placeholder: Availability (Phase 2) */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-zinc-400">
            <ClockIcon className="size-5" />
            Disponibilidade semanal
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Em breve você poderá informar sua disponibilidade para cada dia da
            semana. Esta funcionalidade estará disponível na próxima
            atualização.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
