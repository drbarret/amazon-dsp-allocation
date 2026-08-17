"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  CalendarIcon,
  UsersIcon,
  SparklesIcon,
  CalendarOffIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActionBar } from "@/components/action-bar";
import { WeekSelector } from "@/components/week-selector";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { KpiCard } from "@/components/kpi-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import {
  createVacancy,
  updateVacancy,
  deleteVacancy,
  listVacancies,
  runDistribution,
} from "./actions";
import type { DispatchWeek, Vacancy, VehicleType } from "@/generated/prisma";
import type { RunDistributionResult } from "./actions";

// Display constant — must live in a client-safe module. It used to be
// imported from ./actions (a "use server" file), which made Next.js hand the
// client a server-action reference instead of the array and crashed the page
// with "VEHICLE_TYPES.map is not a function" for any user with a transport
// company.
const VEHICLE_TYPES: VehicleType[] = ["CARGO_VAN", "LARGE_VAN", "PASSEIO"];

const VEHICLE_LABELS: Record<VehicleType, string> = {
  CARGO_VAN: "Cargo Van",
  LARGE_VAN: "Large Van",
  PASSEIO: "Passeio",
};

interface DriverRow {
  id: string;
  name: string;
  email: string;
  driverProfile: {
    id: string;
    vehicleType: VehicleType;
    onboardingCompleted: boolean;
  } | null;
}

interface Props {
  weeks: DispatchWeek[];
  drivers: DriverRow[];
  hasTransportCompany: boolean;
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR");
}

export function DispatchClient({ weeks, drivers, hasTransportCompany }: Props) {
  const [selectedWeekId, setSelectedWeekId] = useState<string>(weeks[0]?.id ?? "");
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [isPending, startTransition] = useTransition();
  const [isLoadingVacancies, setIsLoadingVacancies] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVacancy, setEditingVacancy] = useState<Vacancy | null>(null);
  const [form, setForm] = useState({
    date: "",
    vehicleType: "CARGO_VAN" as VehicleType,
    shiftBlock: "",
    quantity: "1",
  });

  const [confirmDelete, setConfirmDelete] = useState<Vacancy | null>(null);

  const [distribution, setDistribution] = useState<RunDistributionResult | null>(null);
  const [isDistributing, setIsDistributing] = useState(false);

  const selectedWeek = useMemo(
    () => weeks.find((w) => w.id === selectedWeekId) ?? null,
    [weeks, selectedWeekId]
  );

  useEffect(() => {
    loadVacancies(selectedWeekId);
  }, [selectedWeekId]);

  function loadVacancies(weekId: string) {
    if (!weekId) {
      setVacancies([]);
      return;
    }
    setIsLoadingVacancies(true);
    startTransition(async () => {
      try {
        const result = await listVacancies(weekId);
        if (result.success) {
          setVacancies(result.vacancies);
        } else {
          toast.error(result.error ?? "Erro ao carregar vagas.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar vagas.");
      } finally {
        setIsLoadingVacancies(false);
      }
    });
  }

  function openCreate() {
    setEditingVacancy(null);
    setForm({
      date: selectedWeek?.startDate.toString().slice(0, 10) ?? "",
      vehicleType: "CARGO_VAN",
      shiftBlock: "",
      quantity: "1",
    });
    setDialogOpen(true);
  }

  function openEdit(v: Vacancy) {
    setEditingVacancy(v);
    setForm({
      date: v.date.toString().slice(0, 10),
      vehicleType: v.vehicleType,
      shiftBlock: v.shiftBlock,
      quantity: String(v.quantity),
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!selectedWeekId) {
      toast.error("Selecione uma semana.");
      return;
    }

    const payload = {
      dispatchWeekId: selectedWeekId,
      date: form.date,
      vehicleType: form.vehicleType,
      shiftBlock: form.shiftBlock.trim(),
      quantity: Number(form.quantity),
    };

    startTransition(async () => {
      try {
        const result = editingVacancy
          ? await updateVacancy(editingVacancy.id, payload)
          : await createVacancy(payload);

        if (result.success) {
          toast.success(editingVacancy ? "Vaga atualizada." : "Vaga criada.");
          setDialogOpen(false);
          loadVacancies(selectedWeekId);
        } else {
          toast.error(result.error ?? "Erro ao salvar vaga.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao salvar vaga.");
      }
    });
  }

  function handleDelete(v: Vacancy) {
    startTransition(async () => {
      try {
        const result = await deleteVacancy(v.id);
        if (result.success) {
          toast.success("Vaga excluída.");
          setConfirmDelete(null);
          loadVacancies(selectedWeekId);
        } else {
          toast.error(result.error ?? "Erro ao excluir vaga.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao excluir vaga.");
      }
    });
  }

  function handleRunDistribution() {
    if (!selectedWeekId) {
      toast.error("Selecione uma semana.");
      return;
    }
    setIsDistributing(true);
    startTransition(async () => {
      try {
        const result = await runDistribution(selectedWeekId);
        if (result.success && result.result) {
          setDistribution(result.result);
          toast.success(
            `${result.result.assignedCount} vaga(s) atribuída(s).`
          );
        } else {
          toast.error(result.error ?? "Erro ao distribuir vagas.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao distribuir vagas.");
      } finally {
        setIsDistributing(false);
      }
    });
  }

  const vacancyColumns: DataTableColumn<Vacancy>[] = [
    {
      header: "Data",
      sticky: true,
      cell: (v) => (
        <span className="flex items-center gap-1.5">
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          {formatDate(v.date)}
        </span>
      ),
    },
    {
      header: "Categoria",
      cell: (v) => <Badge variant="muted">{VEHICLE_LABELS[v.vehicleType]}</Badge>,
    },
    { header: "Turno/Bloco", cell: (v) => v.shiftBlock },
    {
      header: "Quantidade",
      className: "text-right tabular-nums",
      cell: (v) => v.quantity,
    },
    {
      header: "Ações",
      className: "text-right",
      cell: (v) => (
        <span className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEdit(v)}
            disabled={isPending}
            aria-label={`Editar vaga de ${formatDate(v.date)}`}
          >
            <PencilIcon className="size-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(v)}
            disabled={isPending}
            aria-label={`Excluir vaga de ${formatDate(v.date)}`}
          >
            <Trash2Icon className="size-4 text-destructive" />
          </Button>
        </span>
      ),
    },
  ];

  const driverColumns: DataTableColumn<DriverRow>[] = [
    {
      header: "Motorista",
      sticky: true,
      className: "min-w-0",
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <UsersIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{d.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{d.email}</span>
          </span>
        </span>
      ),
    },
    {
      header: "Veículo",
      className: "whitespace-nowrap",
      cell: (d) =>
        d.driverProfile ? (
          <span className="flex flex-col gap-0.5">
            <Badge variant="muted" className="text-[10px]">
              {VEHICLE_LABELS[d.driverProfile.vehicleType]}
            </Badge>
            {!d.driverProfile.onboardingCompleted && (
              <span className="text-[10px] text-warning-fg">Pendente</span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  if (!hasTransportCompany) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <PageHeader title="Distribuição de Vagas" />
        <EmptyState
          icon={UsersIcon}
          title="Usuário sem transportadora"
          hint="Seu usuário não está vinculado a uma transportadora. Entre em contato com o administrador."
        />
      </div>
    );
  }

  const noWeeks = weeks.length === 0;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Distribuição de Vagas"
        description="Cadastre as vagas da semana e distribua entre os motoristas."
        actions={
          noWeeks ? undefined : (
            <WeekSelector
              weeks={weeks.map((w) => ({
                id: w.id,
                weekKey: w.weekKey,
                startDate: formatDate(w.startDate),
                endDate: formatDate(w.endDate),
              }))}
              value={selectedWeekId}
              onChange={(id) => {
                setSelectedWeekId(id);
                loadVacancies(id);
              }}
              disabled={isPending}
            />
          )
        }
      />

      {noWeeks ? (
        <EmptyState
          icon={CalendarOffIcon}
          title="Nenhuma semana de distribuição cadastrada"
          hint="Ainda não existe nenhuma semana (DispatchWeek) cadastrada para a sua transportadora. O cadastro de semanas estará disponível em uma próxima fase — por enquanto, peça ao administrador para cadastrar a semana."
        />
      ) : (
        <>
          <ActionBar>
            <Button
              onClick={handleRunDistribution}
              disabled={isPending || isDistributing || !selectedWeekId}
              title="Executa o algoritmo de distribuição de vagas"
            >
              <SparklesIcon className="mr-2 size-4" />
              {isDistributing ? "Distribuindo..." : "Distribuir vagas"}
            </Button>
            <Button
              variant="outline"
              onClick={openCreate}
              disabled={isPending || !selectedWeekId}
            >
              <PlusIcon className="mr-2 size-4" />
              Nova Vaga
            </Button>
          </ActionBar>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Vacancies */}
            <div className="min-w-0 lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-heading">Vagas da Semana</h2>
                {selectedWeek && (
                  <Badge variant="muted">
                    {vacancies.reduce((sum, v) => sum + v.quantity, 0)} vagas
                  </Badge>
                )}
              </div>

              <DataTable
                columns={vacancyColumns}
                rows={vacancies}
                loading={isLoadingVacancies}
                ariaLabel="Vagas da semana"
                empty={{
                  icon: CalendarIcon,
                  title: "Nenhuma vaga cadastrada para esta semana",
                  hint: "Crie a primeira vaga para poder distribuir.",
                  action: { label: "Nova Vaga", onClick: openCreate },
                }}
              />
            </div>

            {/* Drivers */}
            <div className="min-w-0 space-y-4">
              <h2 className="text-lg font-semibold text-heading">Motoristas Ativos</h2>
              {/* table-fixed: the card is ~224px wide at 1024px; fixed layout
                  lets the truncatable "Motorista" column shrink to the
                  available space instead of pushing "Veículo" past the
                  viewport (audited defect: column ended at x=1030 @1024). */}
              <DataTable
                columns={driverColumns}
                rows={drivers}
                ariaLabel="Motoristas ativos"
                className="[&_table]:table-fixed"
                empty={{
                  icon: UsersIcon,
                  title: "Nenhum motorista ativo",
                  hint: "Cadastre motoristas para distribuir vagas.",
                }}
              />
            </div>
          </div>

          {/* Distribution results */}
          {distribution && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-heading">
                Resultado da Distribuição
              </h2>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Atribuídas"
                  value={distribution.assignedCount}
                  hint="vagas com motorista"
                  tone="success"
                />
                <KpiCard
                  label="Não atribuídas"
                  value={distribution.unassignedCount}
                  hint="sem motorista elegível"
                />
                <KpiCard
                  label="Abaixo da cota"
                  value={distribution.underQuotaCount}
                  hint="motoristas com menos de 3 vagas"
                  tone="warning"
                />
                <KpiCard
                  label="CNH vencida"
                  value={distribution.expiredCnhCount}
                  hint="atribuídos com CNH fora da validade"
                  tone="danger"
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                {/* Assignments */}
                <div className="min-w-0 lg:col-span-2 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Atribuições</h3>
                  <DataTable
                    ariaLabel="Atribuições"
                    columns={[
                      {
                        header: "Data",
                        sticky: true,
                        cell: (a: RunDistributionResult["assignments"][number]) =>
                          formatDate(a.date),
                      },
                      {
                        header: "Categoria",
                        cell: (a) => (
                          <Badge variant="muted">{VEHICLE_LABELS[a.vehicleType]}</Badge>
                        ),
                      },
                      { header: "Turno", cell: (a) => a.shiftBlock },
                      {
                        header: "Motorista",
                        cell: (a) => (
                          <span className="font-medium text-foreground">
                            {a.name}
                            {a.cnhExpired && (
                              <span className="ml-1 text-warning-fg" aria-hidden>
                                *
                              </span>
                            )}
                          </span>
                        ),
                      },
                    ]}
                    rows={distribution.assignments}
                    empty={{ title: "Nenhuma vaga atribuída." }}
                  />
                  {distribution.assignments.some((a) => a.cnhExpired) && (
                    <p className="text-xs text-muted-foreground">
                      * CNH vencida — motorista atribuído com a CNH fora da
                      validade. Regularize antes do início da semana.
                    </p>
                  )}
                </div>

                {/* Unassigned + under quota */}
                <div className="min-w-0 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Vagas não atribuídas
                    </h3>
                    <div className="mt-2">
                      <DataTable
                        dense
                        ariaLabel="Vagas não atribuídas"
                        columns={[
                          {
                            header: "Data",
                            sticky: true,
                            cell: (v: RunDistributionResult["unassignedVacancies"][number]) =>
                              formatDate(v.date),
                          },
                          {
                            header: "Categoria",
                            cell: (v) => (
                              <Badge variant="muted">{VEHICLE_LABELS[v.vehicleType]}</Badge>
                            ),
                          },
                          {
                            header: "Qtd",
                            className: "text-right tabular-nums",
                            cell: (v) => v.quantity,
                          },
                        ]}
                        rows={distribution.unassignedVacancies}
                        empty={{ title: "Nenhuma." }}
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Motoristas abaixo da cota mínima (3)
                    </h3>
                    <div className="mt-2">
                      <DataTable
                        dense
                        ariaLabel="Motoristas abaixo da cota"
                        columns={[
                          {
                            header: "Motorista",
                            sticky: true,
                            cell: (d: RunDistributionResult["underQuotaDrivers"][number]) => (
                              <span className="font-medium text-foreground">{d.name}</span>
                            ),
                          },
                          {
                            header: "Atribuídas",
                            className: "text-right tabular-nums",
                            cell: (d) => d.assignedCount,
                          },
                        ]}
                        rows={distribution.underQuotaDrivers}
                        empty={{ title: "Nenhum." }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{editingVacancy ? "Editar Vaga" : "Nova Vaga"}</DialogTitle>
          <DialogDescription>
            Preencha os dados da vaga para a semana selecionada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="vacancy-date">Data</Label>
            <Input
              id="vacancy-date"
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vacancy-vehicle">Categoria de Veículo</Label>
            <Select
              value={form.vehicleType}
              onValueChange={(v) => setForm((f) => ({ ...f, vehicleType: v as VehicleType }))}
            >
              <SelectTrigger id="vacancy-vehicle" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((vt) => (
                  <SelectItem key={vt} value={vt}>
                    {VEHICLE_LABELS[vt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vacancy-shift">Bloco/Turno</Label>
            <Input
              id="vacancy-shift"
              placeholder="Ex: Manhã, Tarde, Speed"
              value={form.shiftBlock}
              onChange={(e) => setForm((f) => ({ ...f, shiftBlock: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vacancy-quantity">Quantidade de Vagas</Label>
            <Input
              id="vacancy-quantity"
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Salvando..." : editingVacancy ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title="Excluir Vaga"
        description={
          confirmDelete
            ? `Tem certeza que deseja excluir a vaga de ${formatDate(confirmDelete.date)} — ${VEHICLE_LABELS[confirmDelete.vehicleType]}?`
            : undefined
        }
        confirmLabel="Excluir"
        tone="destructive"
        pending={isPending}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
      />
    </div>
  );
}
