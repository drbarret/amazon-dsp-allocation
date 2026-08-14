"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { SearchIcon, CarIcon } from "lucide-react";
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

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Motoristas
        </h1>
        <p className="text-sm text-zinc-500">
          Gerencie as restrições de veículo dos motoristas. A marcação GNV
          (Gás Natural Veicular) indica que o veículo tem capacidade volumétrica
          reduzida e afeta a alocação nos blocos da Amazon.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <Input
          placeholder="Buscar por nome ou e-mail..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Driver table */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3">Motorista</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Veículo</th>
              <th className="px-4 py-3">Cadastro</th>
              <th className="px-4 py-3 text-center">GNV</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((driver) => (
              <tr key={driver.userId} className="hover:bg-zinc-50">
                {/* Name */}
                <td className="px-4 py-3">
                  <span className="font-medium text-zinc-900">
                    {driver.name}
                  </span>
                </td>

                {/* Email */}
                <td className="px-4 py-3">
                  <span className="text-zinc-600">{driver.email}</span>
                </td>

                {/* Vehicle type */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <CarIcon className="size-3.5 text-zinc-400" />
                    <span className="text-zinc-600">
                      {VEHICLE_LABELS[driver.vehicleType] ?? driver.vehicleType}
                    </span>
                  </div>
                </td>

                {/* Onboarding */}
                <td className="px-4 py-3">
                  {driver.onboardingCompleted ? (
                    <Badge variant="success" className="text-[10px]">Completo</Badge>
                  ) : (
                    <Badge variant="muted" className="text-[10px]">Pendente</Badge>
                  )}
                </td>

                {/* GNV toggle */}
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Checkbox
                      checked={driver.hasGnv}
                      onCheckedChange={(checked) =>
                        handleGnvToggle(driver.userId, !!checked)
                      }
                      disabled={isPending}
                      aria-label={`GNV para ${driver.name}`}
                    />
                    {driver.hasGnv && (
                      <Badge variant="warning" className="text-[10px]">GNV</Badge>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">
                  Nenhum motorista encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400">
        Mostrando {filtered.length} de {drivers.length} motoristas
        {search ? " (filtrado)" : ""}
      </p>
    </div>
  );
}
