import { auth } from "@/lib/auth";
import { roleIsAtLeast } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { findExpiredCnhDrivers } from "@/lib/cnh-collection";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { StatusPill, type StatusPillTone } from "@/components/status-pill";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import {
  CalendarClockIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  ClockIcon,
  IdCardIcon,
  TriangleAlertIcon,
  TruckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/generated/prisma";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  ACCOUNT_MANAGER: "Gerente de Contas",
  SUPERVISOR: "Supervisor",
  DRIVER: "Motorista",
};

const WEEK_STATUS: Record<string, { label: string; tone: StatusPillTone }> = {
  PLANNING: { label: "Pendente", tone: "warning" },
  OPEN: { label: "Aberta", tone: "info" },
  CLOSED: { label: "Fechada", tone: "neutral" },
};

const SHORTCUTS: {
  href: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  iconClass: string;
}[] = [
  {
    href: "/disponibilidades",
    title: "Disponibilidades",
    desc: "Importar e gerenciar disponibilidades dos motoristas",
    icon: CalendarClockIcon,
    iconClass: "bg-info-bg text-info-fg",
  },
  {
    href: "/behavior",
    title: "Comportamento",
    desc: "Infrações, reincidência e fila de aprovação",
    icon: ClipboardListIcon,
    iconClass: "bg-warning-bg text-warning-fg",
  },
  {
    href: "/drivers",
    title: "Motoristas",
    desc: "Gerenciar cadastro, GNV e categoria de veículo",
    icon: UsersIcon,
    iconClass: "bg-success-bg text-success-fg",
  },
  {
    href: "/cnh",
    title: "Cobrar CNH",
    desc: "Enviar cobrança de CNH vencida por e-mail",
    icon: IdCardIcon,
    iconClass: "bg-danger-bg text-danger-fg",
  },
];

function formatWeekDates(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return `${fmt(start)} - ${fmt(end)}`;
}

export default async function DashboardPage() {
  const session = await auth();
  const role = (session?.user?.role ?? "DRIVER") as UserRole;
  const isSupervisorPlus = roleIsAtLeast(role, "SUPERVISOR");

  const greeting = (
    <PageHeader
      title={`Olá, ${session?.user?.name ?? "Usuário"}!`}
      description={ROLE_LABELS[role] ?? role}
    />
  );

  if (!isSupervisorPlus) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        {greeting}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TruckIcon className="size-5 text-success-fg" />
              Cadastro concluído
            </CardTitle>
            <CardDescription>
              Seu perfil de motorista está completo e você está pronto para
              receber alocações.
            </CardDescription>
          </CardHeader>
          <CardFooter className="text-xs text-muted-foreground">
            Em breve: disponibilidade semanal.
          </CardFooter>
        </Card>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session!.user!.id! },
    select: { transportCompanyId: true },
  });
  const transportCompanyId = user?.transportCompanyId ?? null;

  // Cada número vem da MESMA fonte da tela dedicada correspondente:
  // - Motoristas ativos: mesmo where de /drivers (drivers/page.tsx:19-24)
  // - Vagas da semana: DispatchWeek corrente por data + soma de Vacancy.quantity
  //   (mesmas tabelas de Disponibilidades)
  // - CNHs vencidas: findExpiredCnhDrivers (cnh/page.tsx:9)
  // - Infrações pendentes: fila de aprovação, mesmo recorte de
  //   listInfractions (behavior/actions.ts:307-317 e :348)
  const now = new Date();
  const [activeDrivers, expiredCnh, weeks, currentWeekVacancies, pendingInfractions] =
    await Promise.all([
      prisma.user.count({
        where: { role: "DRIVER", active: true, driverProfile: { isNot: null } },
      }),
      findExpiredCnhDrivers(now).then((rows) => rows.length),
      transportCompanyId
        ? prisma.dispatchWeek.findMany({
            where: { transportCompanyId },
            orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
            take: 5,
          })
        : Promise.resolve([]),
      transportCompanyId
        ? prisma.dispatchWeek
            .findFirst({
              where: {
                transportCompanyId,
                startDate: { lte: now },
                endDate: { gte: now },
              },
              select: { id: true },
            })
            .then((week) =>
              week
                ? prisma.vacancy.aggregate({
                    where: { dispatchWeekId: week.id },
                    _sum: { quantity: true },
                  })
                : null,
            )
        : Promise.resolve(null),
      transportCompanyId
        ? prisma.driverInfraction.count({
            where: {
              status: "PENDING_APPROVAL",
              driverProfile: { user: { transportCompanyId } },
            },
          })
        : Promise.resolve(0),
    ]);

  const vacanciesTotal = currentWeekVacancies?._sum?.quantity ?? null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {greeting}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Motoristas Ativos"
          value={activeDrivers}
          hint="cadastrados no sistema"
          icon={UsersIcon}
        />
        <KpiCard
          label="Vagas da Semana"
          value={vacanciesTotal ?? "—"}
          hint={
            vacanciesTotal === null
              ? "nenhuma semana corrente cadastrada"
              : "semana corrente"
          }
          icon={CalendarDaysIcon}
          tone="success"
        />
        <KpiCard
          label="CNHs Vencidas"
          value={expiredCnh}
          hint="aguardando cobrança"
          icon={TriangleAlertIcon}
          tone="danger"
        />
        <KpiCard
          label="Infrações Pendentes"
          value={pendingInfractions}
          hint="na fila de aprovação"
          icon={ClockIcon}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDaysIcon className="size-4" />
            Próximas semanas
          </CardTitle>
        </CardHeader>
        {weeks.length === 0 ? (
          <EmptyState
            icon={CalendarDaysIcon}
            title="Nenhuma semana cadastrada"
            hint="Quando uma semana for cadastrada, o status dela aparece aqui. As disponibilidades são gerenciadas na tela Disponibilidades."
          />
        ) : (
          <ul className="flex flex-col gap-3 px-4 pb-4">
            {weeks.map((w) => {
              const status = WEEK_STATUS[w.status] ?? {
                label: w.status,
                tone: "neutral" as const,
              };
              return (
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ClockIcon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        Semana {w.weekNumber}
                      </p>
                      <p className="text-xs leading-4 text-muted-foreground">
                        {formatWeekDates(w.startDate, w.endDate)}
                      </p>
                    </div>
                  </div>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <section aria-label="Acesso rápido" className="space-y-3">
        <h2 className="text-base font-semibold">Acesso rápido</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {SHORTCUTS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-start gap-3 rounded-xl border border-border bg-card px-6 py-5 shadow-sm transition-colors outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] ${s.iconClass}`}
              >
                <s.icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">
                  {s.title}
                </span>
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                  {s.desc}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
