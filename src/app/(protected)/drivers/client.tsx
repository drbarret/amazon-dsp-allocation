"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SearchIcon, UsersIcon, PencilIcon, StarIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusPill } from "@/components/status-pill";
import {
  saveDriverEdits,
  requestDriverDeactivation,
} from "./actions";
import { reactivateUser } from "@/app/(protected)/admin/users/actions";
import { setDriverGnvMarking } from "@/lib/driver-actions";
import type { DriverRow } from "./page";
import type { UserRole } from "@/generated/prisma";

const VEHICLE_LABELS: Record<string, string> = {
  CARGO_VAN: "Cargo Van",
  LARGE_VAN: "Large Van",
  PASSEIO: "Veículo de Passeio",
};

const ALLOWED_CITIES = [
  "Jundiaí",
  "Louveira",
  "Várzea Paulista",
  "Campo Limpo",
  "Itupeva",
  "Itatiba",
  "Cabreúva",
  "Vinhedo",
];

interface Props {
  drivers: DriverRow[];
  pendingDeactivationCount: number;
  initialStatusFilter: string;
  currentActorRole: UserRole;
}

export function DriversClient({
  drivers,
  pendingDeactivationCount,
  initialStatusFilter,
  currentActorRole,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const statusFilter = searchParams.get("status") ?? initialStatusFilter;

  // Edit modal state
  const [editingDriver, setEditingDriver] = useState<DriverRow | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Deactivation modal state
  const [deactivatingDriver, setDeactivatingDriver] = useState<DriverRow | null>(null);
  const [deactivationReason, setDeactivationReason] = useState("");
  const [deactivating, setDeactivating] = useState(false);

  function handleStatusChange(newStatus: string) {
    const params = new URLSearchParams(window.location.search);
    params.set("status", newStatus);
    router.push(`?${params.toString()}`);
  }

  const filtered = drivers.filter((d) => {
    const q = search.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      d.email.toLowerCase().includes(q) ||
      (d.transporterId ?? "").toLowerCase().includes(q)
    );
  });

  function openEditModal(driver: DriverRow) {
    setEditingDriver(driver);
    setEditForm({
      name: driver.name,
      vehicleType: driver.vehicleType,
      transporterId: driver.transporterId ?? "",
      worksCiclo1: driver.worksCiclo1,
      worksCiclo2: driver.worksCiclo2,
      isTrusted: driver.isTrusted,
      whatsappGroup: driver.whatsappGroup ?? "",
      phone: driver.phoneFormatted ?? "",
      cities: [...driver.cities],
    });
  }

  function closeEditModal() {
    setEditingDriver(null);
    setEditForm({});
  }

  async function handleSave() {
    if (!editingDriver) return;
    setSaving(true);
    try {
      const result = await saveDriverEdits(editingDriver.userId, {
        name: editForm.name as string,
        vehicleType: editForm.vehicleType as string,
        transporterId: (editForm.transporterId as string) || undefined,
        worksCiclo1: editForm.worksCiclo1 as boolean,
        worksCiclo2: editForm.worksCiclo2 as boolean,
        isTrusted: editForm.isTrusted as boolean,
        whatsappGroup: (editForm.whatsappGroup as string) || undefined,
        phone: (editForm.phone as string) || undefined,
        cities: editForm.cities as string[],
      });
      if (result.success) {
        toast.success("Motorista atualizado.");
        closeEditModal();
        router.refresh();
      } else {
        toast.error(result.error ?? "Erro ao salvar.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function handleGnvToggle(userId: string, enabled: boolean) {
    startTransition(async () => {
      try {
        const result = await setDriverGnvMarking(userId, enabled);
        if (result.success) {
          toast.success(
            enabled ? "GNV marcado com sucesso." : "GNV removido com sucesso."
          );
          router.refresh();
        } else {
          toast.error(result.error ?? "Erro ao alterar marcação GNV.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao alterar marcação GNV.");
      }
    });
  }

  function openDeactivationModal(driver: DriverRow) {
    setDeactivatingDriver(driver);
    setDeactivationReason("");
  }

  function closeDeactivationModal() {
    setDeactivatingDriver(null);
    setDeactivationReason("");
  }

  async function handleDeactivate() {
    if (!deactivatingDriver) return;

    setDeactivating(true);
    try {
      const result = await requestDriverDeactivation(
        deactivatingDriver.userId,
        deactivationReason
      );
      if (result.success) {
        if (canDeactivateDirectly) {
          toast.success("Motorista desativado com sucesso.");
        } else {
          toast.success(
            "Solicitação de desativação enviada. O motorista permanece ativo até a aprovação do gerente de conta."
          );
        }
        closeDeactivationModal();
        router.refresh();
      } else {
        toast.error(result.error ?? "Erro ao processar desativação.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar desativação.");
    } finally {
      setDeactivating(false);
    }
  }

  async function handleReactivate(driver: DriverRow) {
    startTransition(async () => {
      try {
        const result = await reactivateUser(driver.userId);
        if (result.success) {
          toast.success("Motorista reativado.");
          router.refresh();
        } else {
          toast.error(result.error ?? "Erro ao reativar.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao reativar.");
      }
    });
  }

  // Determine if current user can deactivate directly (AM/ADMIN) or must request (SUPERVISOR)
  const canDeactivateDirectly = currentActorRole === "ACCOUNT_MANAGER" || currentActorRole === "ADMIN";

  const columns: DataTableColumn<DriverRow>[] = [
    {
      header: "Motorista",
      sticky: true,
      className: "min-w-0",
      cell: (driver) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{driver.name}</div>
          <div className="truncate text-xs text-muted-foreground">{driver.email}</div>
        </div>
      ),
    },
    {
      header: "Telefone",
      className: "whitespace-nowrap",
      cell: (driver) => (
        <span className="text-sm">{driver.phoneFormatted ?? "—"}</span>
      ),
    },
    {
      header: "Transporter ID",
      className: "whitespace-nowrap",
      cell: (driver) => (
        <span className="text-sm font-mono">{driver.transporterId ?? "—"}</span>
      ),
    },
    {
      header: "Veículo",
      className: "whitespace-nowrap",
      cell: (driver) => (
        <StatusPill tone="neutral">
          {VEHICLE_LABELS[driver.vehicleType] ?? driver.vehicleType}
        </StatusPill>
      ),
    },
    {
      header: "GNV",
      className: "whitespace-nowrap",
      cell: (driver) => (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={driver.hasGnv}
            onCheckedChange={(checked) =>
              handleGnvToggle(driver.userId, !!checked)
            }
            disabled={isPending}
            aria-label={`Marcar GNV para ${driver.name}`}
          />
          {driver.hasGnv && <StatusPill tone="info">GNV</StatusPill>}
        </div>
      ),
    },
    {
      header: "Ciclo",
      className: "whitespace-nowrap",
      cell: (driver) => (
        <div className="flex gap-1">
          {driver.worksCiclo1 && <StatusPill tone="info">M</StatusPill>}
          {driver.worksCiclo2 && <StatusPill tone="warning">T</StatusPill>}
          {!driver.worksCiclo1 && !driver.worksCiclo2 && <span className="text-xs text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      header: "Fav",
      className: "whitespace-nowrap text-center",
      cell: (driver) => (
        <StarIcon
          className={`size-4 ${driver.isTrusted ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
        />
      ),
    },
    {
      header: "WhatsApp",
      className: "whitespace-nowrap max-w-[120px]",
      cell: (driver) => (
        <span className="truncate text-sm" title={driver.whatsappGroup ?? ""}>
          {driver.whatsappGroup ?? "—"}
        </span>
      ),
    },
    {
      header: "Status",
      className: "whitespace-nowrap",
      cell: (driver) =>
        driver.active ? (
          <StatusPill tone="success">Ativo</StatusPill>
        ) : (
          <StatusPill tone="danger">Inativo</StatusPill>
        ),
    },
    {
      header: "Ações",
      className: "whitespace-nowrap text-right",
      cell: (driver) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => openEditModal(driver)}
            className="rounded p-1 hover:bg-accent"
            aria-label={`Editar ${driver.name}`}
            title="Editar"
          >
            <PencilIcon className="size-4" />
          </button>
          {driver.active && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openDeactivationModal(driver)}
              disabled={isPending}
            >
              Desativar
            </Button>
          )}
          {!driver.active && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleReactivate(driver)}
              disabled={isPending}
            >
              Reativar
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Motoristas"
        description="Gerencie cadastros de motoristas. Edição inline disponível para Supervisores, Gerentes de Conta e Admins."
      />

      {/* Pending deactivation badge */}
      {pendingDeactivationCount > 0 && (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-800">
          {pendingDeactivationCount} solicitação(ões) de desativação pendente(s) de aprovação.
          <a href="/drivers/deactivation-requests" className="ml-2 underline">
            Ver solicitações
          </a>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-2">
        {[
          { key: "active", label: "Ativos" },
          { key: "inactive", label: "Inativos" },
          { key: "all", label: "Todos" },
        ].map((tab) => (
          <Button
            key={tab.key}
            variant={statusFilter === tab.key ? "default" : "outline"}
            size="sm"
            onClick={() => handleStatusChange(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, e-mail ou Transporter ID..."
          aria-label="Buscar motorista"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Desktop: table view */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={filtered}
          dense
          ariaLabel="Motoristas cadastrados"
          empty={{
            icon: UsersIcon,
            title: search
              ? "Nenhum motorista encontrado para esta busca"
              : "Nenhum motorista cadastrado",
            hint: search
              ? "Limpe a busca ou ajuste os critérios."
              : "Os motoristas aparecem aqui após concluírem o cadastro.",
          }}
        />
      </div>

      {/* Mobile: card view */}
      <div className="space-y-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <UsersIcon className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium text-foreground">
              {search
                ? "Nenhum motorista encontrado para esta busca"
                : "Nenhum motorista cadastrado"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search
                ? "Limpe a busca ou ajuste os critérios."
                : "Os motoristas aparecem aqui após concluírem o cadastro."}
            </p>
          </div>
        ) : (
          filtered.map((driver) => (
            <div
              key={driver.userId}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{driver.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{driver.email}</div>
                </div>
                <div className="shrink-0">
                  {driver.active ? (
                    <StatusPill tone="success">Ativo</StatusPill>
                  ) : (
                    <StatusPill tone="danger">Inativo</StatusPill>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {driver.phoneFormatted && (
                  <span>{driver.phoneFormatted}</span>
                )}
                {driver.transporterId && (
                  <span className="font-mono">{driver.transporterId}</span>
                )}
                <span>{VEHICLE_LABELS[driver.vehicleType] ?? driver.vehicleType}</span>
                {(driver.worksCiclo1 || driver.worksCiclo2) && (
                  <span>
                    {[driver.worksCiclo1 && "M", driver.worksCiclo2 && "T"].filter(Boolean).join("/")}
                  </span>
                )}
                {driver.hasGnv && <StatusPill tone="info">GNV</StatusPill>}
                {driver.isTrusted && <StarIcon className="size-3 fill-yellow-400 text-yellow-400" />}
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditModal(driver)}
                  className="flex-1"
                >
                  <PencilIcon className="mr-1 size-3" />
                  Editar
                </Button>
                {driver.active ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openDeactivationModal(driver)}
                    disabled={isPending}
                    className="flex-1"
                  >
                    Desativar
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReactivate(driver)}
                    disabled={isPending}
                    className="flex-1"
                  >
                    Reativar
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Mostrando {filtered.length} de {drivers.length} motoristas
        {search ? " (filtrado)" : ""}
      </p>

      {/* Edit Modal */}
      {editingDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Editar Motorista</h2>

            <div className="space-y-3">
              <label className="block text-sm font-medium">Nome</label>
              <Input
                value={(editForm.name as string) ?? ""}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                maxLength={200}
              />

              <label className="block text-sm font-medium">E-mail (somente leitura)</label>
              <Input value={editingDriver.email} disabled />

              <label className="block text-sm font-medium">Telefone</label>
              <Input
                value={(editForm.phone as string) ?? ""}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                placeholder="(11) 99999-9999"
              />

              <label className="block text-sm font-medium">Tipo de Veículo</label>
              <select
                className="w-full rounded border px-3 py-2 text-sm"
                value={(editForm.vehicleType as string) ?? "CARGO_VAN"}
                onChange={(e) => setEditForm({ ...editForm, vehicleType: e.target.value })}
              >
                <option value="CARGO_VAN">Cargo Van</option>
                <option value="LARGE_VAN">Large Van</option>
                <option value="PASSEIO">Veículo de Passeio</option>
              </select>

              <label className="block text-sm font-medium">Transporter ID</label>
              <Input
                value={(editForm.transporterId as string) ?? ""}
                onChange={(e) => setEditForm({ ...editForm, transporterId: e.target.value })}
              />

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!editForm.worksCiclo1}
                    onCheckedChange={(c) => setEditForm({ ...editForm, worksCiclo1: !!c })}
                  />
                  Manhã (Ciclo 1)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!editForm.worksCiclo2}
                    onCheckedChange={(c) => setEditForm({ ...editForm, worksCiclo2: !!c })}
                  />
                  Tarde (Ciclo 2)
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={!!editForm.isTrusted}
                  onCheckedChange={(c) => setEditForm({ ...editForm, isTrusted: !!c })}
                />
                Favorito (Confiança)
              </label>

              <label className="block text-sm font-medium">Grupo WhatsApp</label>
              <Input
                value={(editForm.whatsappGroup as string) ?? ""}
                onChange={(e) => setEditForm({ ...editForm, whatsappGroup: e.target.value })}
                maxLength={80}
              />

              <label className="block text-sm font-medium">Cidades (até 3)</label>
              <div className="flex flex-wrap gap-2">
                {ALLOWED_CITIES.map((city) => {
                  const selected = (editForm.cities as string[]) ?? [];
                  const isSelected = selected.includes(city);
                  return (
                    <button
                      key={city}
                      type="button"
                      onClick={() => {
                        const next = isSelected
                          ? selected.filter((c) => c !== city)
                          : selected.length < 3
                            ? [...selected, city]
                            : selected;
                        setEditForm({ ...editForm, cities: next });
                      }}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {city}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeEditModal} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivation Modal */}
      {deactivatingDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-lg bg-background p-6 shadow-xl">
            <h2 className="text-lg font-semibold">
              {canDeactivateDirectly ? "Desativar Motorista" : "Solicitar Desativação"}
            </h2>

            <p className="text-sm text-muted-foreground">
              {canDeactivateDirectly
                ? `Você está prestes a desativar o motorista ${deactivatingDriver.name}. Esta ação é imediata.`
                : `Como supervisor, sua solicitação será enviada para aprovação do gerente de conta. O motorista ${deactivatingDriver.name} permanecerá ativo até a aprovação.`}
            </p>

            <div className="space-y-2">
              <label className="block text-sm font-medium">
                Motivo {canDeactivateDirectly ? "(opcional)" : "(obrigatório)"}
              </label>
              <textarea
                className="w-full rounded border px-3 py-2 text-sm"
                rows={3}
                value={deactivationReason}
                onChange={(e) => setDeactivationReason(e.target.value)}
                placeholder="Informe o motivo da desativação..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDeactivationModal} disabled={deactivating}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeactivate}
                disabled={deactivating || (!canDeactivateDirectly && !deactivationReason.trim())}
              >
                {deactivating
                  ? "Processando..."
                  : canDeactivateDirectly
                    ? "Desativar"
                    : "Enviar Solicitação"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
