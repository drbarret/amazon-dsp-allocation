"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  AlertTriangleIcon,
  CheckCircle2Icon,
  FlagIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react";
import {
  markInfraction,
  approveInfraction,
  rejectInfraction,
  escalateRecidivism,
  listInfractions,
} from "./actions";
import type { BehaviorDriverRow, BehaviorWeekRow } from "./page";
import type { InfractionType } from "@/generated/prisma";

interface InfractionTypeOption {
  type: InfractionType;
  label: string;
  requiresApproval: boolean;
  punishment: string;
}

interface InfractionRow {
  id: string;
  type: InfractionType;
  typeLabel: string;
  punishment: string;
  observation: string | null;
  weekKey: string;
  effectiveWeekKey: string;
  status: string;
  multiplier: number;
  driverName: string;
  driverUserId: string;
  markedByName: string | null;
  approvedByName: string | null;
  createdAt: string;
  fulfilledAt: string | null;
  supervisorNotifiedAt: string | null;
  escalatedAt: string | null;
  escalationDue: boolean;
}

interface Props {
  drivers: BehaviorDriverRow[];
  weeks: BehaviorWeekRow[];
  infractionTypes: InfractionTypeOption[];
}

const STATUS_BADGE: Record<string, "warning" | "default" | "success" | "muted" | "destructive"> = {
  PENDING_APPROVAL: "warning",
  ACTIVE: "default",
  FULFILLED: "success",
  CANCELLED: "muted",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Aguardando aprovação",
  ACTIVE: "Em cumprimento",
  FULFILLED: "Cumprida",
  CANCELLED: "Rejeitada",
};

export function BehaviorClient({ drivers, weeks, infractionTypes }: Props) {
  const [isPending, startTransition] = useTransition();
  const [markOpen, setMarkOpen] = useState(false);
  const [driverId, setDriverId] = useState("");
  const [type, setType] = useState<InfractionType | "">("");
  const [weekId, setWeekId] = useState("");
  const [observation, setObservation] = useState("");
  const [data, setData] = useState<{
    infractions: InfractionRow[];
    approvalQueue: InfractionRow[];
    pending: InfractionRow[];
    recidivismWarnings: InfractionRow[];
    canApprove: boolean;
  } | null>(null);

  function refresh() {
    startTransition(async () => {
      const result = await listInfractions();
      if (result.success && result.data) {
        setData(result.data);
      }
    });
  }

  // Load on first mount.
  useEffect(() => {
    refresh();
  }, []);

  function handleMark() {
    if (!driverId || !type || !weekId) {
      toast.error("Preencha motorista, tipo e semana.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await markInfraction({
          driverProfileId: driverId,
          type,
          dispatchWeekId: weekId,
          observation,
        });
        if (result.success) {
          toast.success(
            result.infraction?.recidivism
              ? "Infração marcada (reincidência — punição dobrada)."
              : "Infração marcada."
          );
          setMarkOpen(false);
          setDriverId("");
          setType("");
          setWeekId("");
          setObservation("");
          refresh();
        } else {
          toast.error(result.error ?? "Erro ao marcar infração.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao marcar infração.");
      }
    });
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      const result = await approveInfraction(id);
      if (result.success) toast.success("Infração aprovada.");
      else toast.error(result.error ?? "Erro ao aprovar.");
      refresh();
    });
  }

  function handleReject(id: string) {
    startTransition(async () => {
      const result = await rejectInfraction(id);
      if (result.success) toast.success("Infração rejeitada.");
      else toast.error(result.error ?? "Erro ao rejeitar.");
      refresh();
    });
  }

  function handleEscalate(id: string) {
    startTransition(async () => {
      const result = await escalateRecidivism(id);
      if (result.success) toast.success("Reincidência escalada aos gerentes.");
      else toast.error(result.error ?? "Erro ao escalar.");
      refresh();
    });
  }

  const selectedType = infractionTypes.find((t) => t.type === type);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Comportamento do Motorista
          </h1>
          <p className="text-sm text-zinc-500">
            Marque infrações, acompanhe punições e reincidências. A punição é
            definida pelo tipo, nunca pelo supervisor.
          </p>
        </div>
        <Button onClick={() => setMarkOpen(true)} disabled={isPending}>
          <FlagIcon className="mr-2 size-4" />
          Marcar Infração
        </Button>
      </div>

      {/* Recidivism warnings */}
      {data && data.recidivismWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <ShieldAlertIcon className="size-4" />
            Avisos de reincidência
          </h2>
          <ul className="space-y-2">
            {data.recidivismWarnings.map((w) => (
              <li
                key={w.id}
                className="flex flex-col gap-1 rounded-md border border-amber-200 bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-medium text-zinc-900">{w.driverName}</span>
                  <span className="text-zinc-500"> — {w.typeLabel}</span>
                  <Badge variant="destructive" className="ml-2 text-[10px]">
                    punição dobrada
                  </Badge>
                  {w.escalationDue && (
                    <Badge variant="warning" className="ml-2 text-[10px]">
                      escalonamento pendente
                    </Badge>
                  )}
                </div>
                {data.canApprove && w.escalationDue && !w.escalatedAt && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEscalate(w.id)}
                    disabled={isPending}
                  >
                    Escalar aos gerentes
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Approval queue (account managers) */}
      {data?.canApprove && data.approvalQueue.length > 0 && (
        <div className="rounded-lg border bg-white">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">
              Fila de aprovação (reclamação áspera)
            </h2>
            <p className="text-xs text-zinc-500">
              Apenas o tipo subjetivo exige aprovação do gerente de contas.
            </p>
          </div>
          <ul className="divide-y">
            {data.approvalQueue.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-medium text-zinc-900">{i.driverName}</span>
                  <span className="text-zinc-500"> — {i.typeLabel}</span>
                  {i.observation && (
                    <p className="text-xs text-zinc-400">“{i.observation}”</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReject(i.id)}
                    disabled={isPending}
                  >
                    <XCircleIcon className="mr-1 size-3" /> Rejeitar
                  </Button>
                  <Button size="sm" onClick={() => handleApprove(i.id)} disabled={isPending}>
                    <CheckCircle2Icon className="mr-1 size-3" /> Aprovar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Punishment panel */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3">Motorista</th>
              <th className="px-4 py-3">Infração</th>
              <th className="px-4 py-3">Punição</th>
              <th className="px-4 py-3">Semana efetiva</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Marcado por</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(data?.infractions ?? []).map((i) => (
              <tr key={i.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-900">{i.driverName}</td>
                <td className="px-4 py-3 text-zinc-600">{i.typeLabel}</td>
                <td className="px-4 py-3">
                  <Badge variant={i.multiplier > 1 ? "destructive" : "default"}>
                    {i.punishment}
                    {i.multiplier > 1 && " (dobrada)"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-zinc-600">{i.effectiveWeekKey}</td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_BADGE[i.status] ?? "muted"}>
                    {STATUS_LABEL[i.status] ?? i.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-zinc-500">{i.markedByName ?? "—"}</td>
              </tr>
            ))}
            {(data?.infractions ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-400">
                  Nenhuma infração registrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mark infraction dialog */}
      <Dialog open={markOpen} onOpenChange={setMarkOpen}>
        <DialogHeader>
          <DialogTitle>Marcar Infração</DialogTitle>
          <DialogDescription>
            Escolha o motorista e o tipo de infração. A punição é definida pelo
            tipo e aplicada na semana seguinte.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Motorista</Label>
            <Select value={driverId} onValueChange={(v) => setDriverId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o motorista" />
              </SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.driverProfileId} value={d.driverProfileId}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tipo de infração</Label>
            <Select
              value={type}
              onValueChange={(v) => setType((v ?? "") as InfractionType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                {infractionTypes.map((t) => (
                  <SelectItem key={t.type} value={t.type}>
                    {t.label} — {t.punishment}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedType?.requiresApproval && (
              <p className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangleIcon className="size-3" />
                Tipo subjetivo: exige aprovação do gerente de contas.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Semana da ocorrência</Label>
            <Select value={weekId} onValueChange={(v) => setWeekId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a semana" />
              </SelectTrigger>
              <SelectContent>
                {weeks.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.weekKey} ({w.startDate} a {w.endDate})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="obs">Observação (opcional)</Label>
            <textarea
              id="obs"
              value={observation}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setObservation(e.target.value)
              }
              placeholder="Detalhes da ocorrência..."
              maxLength={500}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setMarkOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleMark} disabled={isPending}>
            {isPending ? "Marcando..." : "Marcar"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
