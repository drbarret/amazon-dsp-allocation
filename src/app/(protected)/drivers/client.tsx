"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { SearchIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusPill } from "@/components/status-pill";
import { setDriverGnvMarking } from "@/lib/driver-actions";
import type { DriverRow } from "./page";

const VEHICLE_LABELS: Record<string, string> = {
  CARGO_VAN: "Cargo Van",
  PASSEIO: "Veículo de Passeio",
};

interface Props {
  drivers: DriverRow[];
}

export function DriversClient({ drivers }: Props) {
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const filtered = drivers.filter((d) => {
    const q = search.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      d.email.toLowerCase().includes(q)
    );
  });

  function handleGnvToggle(userId: string, enabled: boolean) {
    startTransition(async () => {
      try {
        const result = await setDriverGnvMarking(userId, enabled);
        if (result.success) {
          toast.success(
            enabled ? "GNV marcado com sucesso." : "GNV removido com sucesso."
          );
        } else {
          toast.error(result.error ?? "Erro ao alterar marcação GNV.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao alterar marcação GNV.");
      }
    });
  }

  const columns: DataTableColumn<DriverRow>[] = [
    {
      header: "Motorista",
      sticky: true,
      className: "min-w-0",
      cell: (driver) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">
            {driver.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {driver.email}
          </div>
        </div>
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
      header: "Cadastro",
      className: "whitespace-nowrap",
      cell: (driver) =>
        driver.onboardingCompleted ? (
          <StatusPill tone="success">Completo</StatusPill>
        ) : (
          <StatusPill tone="warning">Pendente</StatusPill>
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
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Motoristas"
        description="Gerencie as restrições de veículo dos motoristas. A marcação GNV (Gás Natural Veicular) indica capacidade volumétrica reduzida e afeta a alocação nos blocos da Amazon."
      />

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou e-mail..."
          aria-label="Buscar motorista"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

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
            ? "Limpe a busca ou ajuste os critérios para ver mais resultados."
            : "Os motoristas aparecem aqui após concluírem o cadastro.",
        }}
      />

      <p className="text-xs text-muted-foreground">
        Mostrando {filtered.length} de {drivers.length} motoristas
        {search ? " (filtrado)" : ""}
      </p>
    </div>
  );
}
