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
} from "lucide-react";
import {
  createVacancy,
  updateVacancy,
  deleteVacancy,
  listVacancies,
  VEHICLE_TYPES,
} from "./actions";
import type { DispatchWeek, Vacancy, VehicleType } from "@/generated/prisma";

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

  if (!hasTransportCompany) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Distribuição de Vagas
        </h1>
        <p className="text-sm text-zinc-500">
          Seu usuário não está vinculado a uma transportadora. Entre em contato com o administrador.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Distribuição de Vagas
          </h1>
          <p className="text-sm text-zinc-500">
            Cadastre as vagas da semana e visualize os motoristas disponíveis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled
            title="Distribuição automática em breve"
          >
            <SparklesIcon className="mr-2 size-4" />
            Distribuir Automaticamente
          </Button>
          <Button onClick={openCreate} disabled={isPending || !selectedWeekId}>
            <PlusIcon className="mr-2 size-4" />
            Nova Vaga
          </Button>
        </div>
      </div>

      {/* Week selector */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Label htmlFor="week-select" className="text-sm font-medium text-zinc-700">
          Semana
        </Label>
        <Select
          value={selectedWeekId}
          onValueChange={(v) => {
            if (!v) return;
            setSelectedWeekId(v);
            loadVacancies(v);
          }}
          disabled={isPending}
        >
          <SelectTrigger id="week-select" className="w-full sm:w-80">
            <SelectValue placeholder="Selecione uma semana" />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.weekKey} — {new Date(w.startDate).toLocaleDateString("pt-BR")} a{" "}
                {new Date(w.endDate).toLocaleDateString("pt-BR")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {weeks.length === 0 && (
          <span className="text-xs text-zinc-400">Nenhuma semana cadastrada.</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Vacancies */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">Vagas da Semana</h2>
            {selectedWeek && (
              <Badge variant="muted">
                {vacancies.reduce((sum, v) => sum + v.quantity, 0)} vagas
              </Badge>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Turno/Bloco</th>
                  <th className="px-4 py-3">Quantidade</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoadingVacancies ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">
                      Carregando vagas...
                    </td>
                  </tr>
                ) : vacancies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">
                      Nenhuma vaga cadastrada para esta semana.
                    </td>
                  </tr>
                ) : (
                  vacancies.map((v) => (
                    <tr key={v.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <CalendarIcon className="size-3.5 text-zinc-400" />
                          <span>{new Date(v.date).toLocaleDateString("pt-BR")}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="muted">{VEHICLE_LABELS[v.vehicleType]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-zinc-700">{v.shiftBlock}</td>
                      <td className="px-4 py-3 text-zinc-700">{v.quantity}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(v)}
                            disabled={isPending}
                            title="Editar vaga"
                          >
                            <PencilIcon className="size-4 text-zinc-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDelete(v)}
                            disabled={isPending}
                            title="Excluir vaga"
                          >
                            <Trash2Icon className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Drivers */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-900">Motoristas Ativos</h2>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Motorista</th>
                  <th className="px-4 py-3">Veículo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {drivers.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-sm text-zinc-400">
                      Nenhum motorista ativo.
                    </td>
                  </tr>
                ) : (
                  drivers.map((d) => (
                    <tr key={d.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <UsersIcon className="size-3.5 text-zinc-400" />
                          <div>
                            <div className="font-medium text-zinc-900">{d.name}</div>
                            <div className="text-xs text-zinc-500">{d.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {d.driverProfile ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="muted" className="text-[10px]">
                              {VEHICLE_LABELS[d.driverProfile.vehicleType]}
                            </Badge>
                            {!d.driverProfile.onboardingCompleted && (
                              <span className="text-[10px] text-amber-600">Pendente</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>Excluir Vaga</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja excluir a vaga de{" "}
            {confirmDelete && new Date(confirmDelete.date).toLocaleDateString("pt-BR")} —{" "}
            {confirmDelete && VEHICLE_LABELS[confirmDelete.vehicleType]}?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => confirmDelete && handleDelete(confirmDelete)}
            disabled={isPending}
          >
            {isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
