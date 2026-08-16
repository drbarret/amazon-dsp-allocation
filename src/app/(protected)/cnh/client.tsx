"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { MailIcon, IdCardIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusPill } from "@/components/status-pill";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { collectCnh } from "./actions";

export interface ExpiredCnhRow {
  driverProfileId: string;
  userId: string;
  name: string;
  email: string;
  cnhExpiration: string;
  lastCollectedAt: string | null;
}

interface Props {
  drivers: ExpiredCnhRow[];
  currentUserId: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Nunca cobrado";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CnhCollectionClient({ drivers, currentUserId }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<{
    sent: number;
    degraded: number;
    failed: { name: string; reason: string }[];
    rejected: { name: string; reason: string }[];
  } | null>(null);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === drivers.length
        ? new Set()
        : new Set(drivers.map((d) => d.userId))
    );
  }

  function handleCollect() {
    if (selected.size === 0) {
      toast.error("Selecione ao menos um motorista.");
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirmSend() {
    setConfirmOpen(false);
    startTransition(async () => {
      try {
        const result = await collectCnh([...selected]);
        if (!result.success) {
          toast.error("Não foi possível enviar a cobrança.");
          return;
        }
        setSummary({
          sent: result.sent,
          degraded: result.degraded,
          failed: result.failed,
          rejected: result.rejected,
        });
        setSelected(new Set());
        if (result.sent > 0) {
          toast.success(`${result.sent} cobrança(s) enviada(s).`);
        } else if (result.degraded > 0) {
          toast.warning(
            "E-mail não configurado neste ambiente; avise o administrador."
          );
        } else {
          toast.info("Nenhuma cobrança enviada.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao enviar cobrança.");
      }
    });
  }

  const allSelected = drivers.length > 0 && selected.size === drivers.length;
  const selectedNames = drivers
    .filter((d) => selected.has(d.userId))
    .map((d) => d.name);

  const columns: DataTableColumn<ExpiredCnhRow>[] = [
    {
      header: (
        <Checkbox
          checked={allSelected}
          onCheckedChange={toggleAll}
          aria-label="Selecionar todos"
        />
      ),
      className: "w-10",
      cell: (d) => (
        <Checkbox
          checked={selected.has(d.userId)}
          onCheckedChange={() => toggle(d.userId)}
          aria-label={`Selecionar ${d.name}`}
        />
      ),
    },
    {
      header: "Motorista",
      sticky: true,
      className: "min-w-0",
      cell: (d) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {d.name}
            </span>
            {d.userId === currentUserId && (
              <StatusPill tone="neutral">você</StatusPill>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {d.email}
          </div>
        </div>
      ),
    },
    {
      header: "CNH válida até",
      className: "whitespace-nowrap tabular-nums",
      cell: (d) => (
        <StatusPill tone="danger">{formatDate(d.cnhExpiration)}</StatusPill>
      ),
    },
    {
      header: "Última cobrança",
      className: "whitespace-nowrap tabular-nums",
      cell: (d) => (
        <span className="text-xs text-muted-foreground">
          {formatDateTime(d.lastCollectedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Cobrar CNH"
        description="Motoristas ativos com CNH vencida. Selecione quem deve receber a cobrança por e-mail."
        actions={
          <Button
            onClick={handleCollect}
            disabled={isPending || selected.size === 0}
          >
            <MailIcon className="mr-2 size-4" />
            {isPending
              ? "Enviando..."
              : `Enviar cobrança${selected.size > 0 ? ` (${selected.size} selecionado${selected.size > 1 ? "s" : ""})` : ""}`}
          </Button>
        }
      />

      {/* Summary after a send */}
      {summary && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Resumo do envio
          </h2>
          <ul className="space-y-2">
            {summary.sent > 0 && (
              <li className="flex items-start gap-2">
                <StatusPill tone="success">Enviado</StatusPill>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{summary.sent}</strong>{" "}
                  cobrança(s) enviada(s) com sucesso.
                </span>
              </li>
            )}
            {summary.degraded > 0 && (
              <li className="flex items-start gap-2">
                <StatusPill tone="warning">Ambiente</StatusPill>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{summary.degraded}</strong>{" "}
                  não enviada(s) — e-mail não configurado neste ambiente; avise
                  o administrador.
                </span>
              </li>
            )}
            {summary.failed.map((f) => (
              <li key={f.name} className="flex items-start gap-2">
                <StatusPill tone="danger">Falha</StatusPill>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{f.name}</strong> —{" "}
                  {f.reason}
                </span>
              </li>
            ))}
            {summary.rejected.map((r) => (
              <li key={r.name} className="flex items-start gap-2">
                <StatusPill tone="neutral">Não enviado</StatusPill>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{r.name}</strong> —{" "}
                  {r.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={drivers}
        dense
        ariaLabel="Motoristas com CNH vencida"
        empty={{
          icon: IdCardIcon,
          title: "Nenhum motorista com CNH vencida",
          hint: "Quando a CNH de um motorista ativo vencer, ele aparecerá aqui para cobrança.",
        }}
      />

      <p className="text-xs text-muted-foreground">
        {drivers.length} motorista(s) com CNH vencida. O reenvio é permitido —
        cada cobrança fica registrada com data/hora e autor.
      </p>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Enviar cobrança de CNH"
        description={
          selectedNames.length === 1
            ? `Enviar cobrança por e-mail para ${selectedNames[0]}.`
            : `Enviar cobrança por e-mail para ${selectedNames.length} motoristas: ${selectedNames.join(", ")}.`
        }
        confirmLabel={`Enviar para ${selected.size} motorista${selected.size > 1 ? "s" : ""}`}
        pending={isPending}
        onConfirm={handleConfirmSend}
      />
    </div>
  );
}
