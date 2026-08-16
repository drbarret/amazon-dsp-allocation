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
import { PageHeader } from "@/components/page-header";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusPill, type StatusPillTone } from "@/components/status-pill";
import { ConfirmDialog } from "@/components/confirm-dialog";
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

const STATUS_TONE: Record<string, StatusPillTone> = {
  PENDING_APPROVAL: "warning",
  ACTIVE: "info",
  FULFILLED: "success",
  CANCELLED: "neutral",
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
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
  // `null` = ainda carregando. A tabela NUNCA mostra o estado vazio enquanto
  // `data` for null — este era o bug do falso vazio (P4).
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
      setConfirmRejectId(null);
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
  const loading = data === null;

  const infractionColumns: DataTableColumn<InfractionRow>[] = [
    {
      header: "Motorista",
      sticky: true,
      cell: (i) => <span className="font-medium text-foreground">{i.driverName}</span>,
    },
    { header: "Infração", cell: (i) => i.typeLabel },
    {
      header: "Punição",
      cell: (i) => (
        <Badge variant={i.multiplier > 1 ? "destructive" : "default"}>
          {i.punishment}
          {i.multiplier > 1 && " (dobrada)"}
        </Badge>
      ),
    },
    { header: "Semana efetiva", cell: (i) => i.effectiveWeekKey },
    {
      header: "Status",
      cell: (i) => (
        <StatusPill tone={STATUS_TONE[i.status] ?? "neutral"}>
          {STATUS_LABEL[i.status] ?? i.status}
        </StatusPill>
      ),
    },
    { header: "Marcado por", cell: (i) => i.markedByName ?? "—" },
  ];

  const approvalColumns: DataTableColumn<InfractionRow>[] = [
    {
      header: "Motorista",
      sticky: true,
      cell: (i) => (
        <span>
          <span className="font-medium text-foreground">{i.driverName}</span>
          {i.observation && (
            <span className="block text-xs text-muted-foreground">
              “{i.observation}”
            </span>
          )}
        </span>
      ),
    },
    { header: "Infração", cell: (i) => i.typeLabel },
    { header: "Marcado por", cell: (i) => i.markedByName ?? "—" },
    {
      header: "Ações",
      className: "text-right",
      cell: (i) => (
        <span className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmRejectId(i.id)}
            disabled={isPending}
            aria-label={`Rejeitar infração de ${i.driverName}`}
          >
            <XCircleIcon className="mr-1 size-3" /> Rejeitar
          </Button>
          <Button
            size="sm"
            onClick={() => handleApprove(i.id)}
            disabled={isPending}
            aria-label={`Aprovar infração de ${i.driverName}`}
          >
            <CheckCircle2Icon className="mr-1 size-3" /> Aprovar
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Comportamento do Motorista"
        description="Marque infrações, acompanhe punições e reincidências. A punição é definida pelo tipo, nunca pelo supervisor."
        actions={
          <Button onClick={() => setMarkOpen(true)} disabled={isPending}>
            <FlagIcon className="mr-2 size-4" />
            Marcar Infração
          </Button>
        }
      />

      {/* Recidivism warnings */}
      {data && data.recidivismWarnings.length > 0 && (
        <div className="rounded-xl border border-warning-border bg-warning-bg p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning-fg">
            <ShieldAlertIcon className="size-4" />
            Avisos de reincidência
          </h2>
          <ul className="space-y-2">
            {data.recidivismWarnings.map((w) => (
              <li
                key={w.id}
                className="flex flex-col gap-2 rounded-lg border border-warning-border bg-card p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{w.driverName}</span>
                  <span className="text-muted-foreground">— {w.typeLabel}</span>
                  <StatusPill tone="danger">punição dobrada</StatusPill>
                  {w.escalationDue && (
                    <StatusPill tone="warning">escalonamento pendente</StatusPill>
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
        <div className="space-y-2">
          <div>
            <h2 className="text-lg font-semibold text-heading">
              Fila de aprovação (reclamação áspera)
            </h2>
            <p className="text-xs text-muted-foreground">
              Apenas o tipo subjetivo exige aprovação do gerente de contas.
            </p>
          </div>
          <DataTable
            ariaLabel="Fila de aprovação"
            columns={approvalColumns}
            rows={data.approvalQueue}
            empty={{ title: "Nenhuma infração aguardando aprovação." }}
          />
        </div>
      )}

      {/* Punishment panel */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-heading">Ciclo de punição</h2>
        <DataTable
          ariaLabel="Ciclo de punição"
          columns={infractionColumns}
          rows={data?.infractions ?? []}
          loading={loading}
          empty={{
            icon: FlagIcon,
            title: "Nenhuma infração registrada",
            hint: "Quando uma infração for marcada, ela aparece aqui com a punição e o status.",
          }}
        />
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
              <p className="flex items-center gap-1 text-xs text-warning-fg">
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

      {/* Reject confirmation */}
      <ConfirmDialog
        open={confirmRejectId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRejectId(null);
        }}
        title="Rejeitar Infração"
        description="A infração será cancelada e não gera punição. Esta ação não pode ser desfeita."
        confirmLabel="Rejeitar"
        tone="destructive"
        pending={isPending}
        onConfirm={() => confirmRejectId && handleReject(confirmRejectId)}
      />
    </div>
  );
}
