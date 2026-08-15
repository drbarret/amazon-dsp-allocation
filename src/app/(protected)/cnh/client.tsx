"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  MailIcon,
  ClockIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  XCircleIcon,
} from "lucide-react";
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
          toast.warning("E-mail não configurado (RESEND_API_KEY ausente).");
        } else {
          toast.info("Nenhuma cobrança enviada.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao enviar cobrança.");
      }
    });
  }

  const allSelected = drivers.length > 0 && selected.size === drivers.length;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Cobrança de CNH
          </h1>
          <p className="text-sm text-zinc-500">
            Motoristas ativos com CNH vencida. Marque quem deve receber a
            cobrança e clique em &quot;Cobrar CNH atualizada&quot;.
          </p>
        </div>
        <Button onClick={handleCollect} disabled={isPending || selected.size === 0}>
          <MailIcon className="mr-2 size-4" />
          {isPending
            ? "Enviando..."
            : `Cobrar CNH atualizada${selected.size > 0 ? ` (${selected.size})` : ""}`}
        </Button>
      </div>

      {/* Summary after a send */}
      {summary && (
        <div className="rounded-lg border bg-white p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium text-zinc-900">
            <CheckCircle2Icon className="size-4 text-emerald-600" />
            Resumo do envio
          </div>
          <ul className="space-y-1 text-zinc-600">
            <li>
              <span className="font-medium text-emerald-600">{summary.sent}</span>{" "}
              enviado(s)
            </li>
            {summary.degraded > 0 && (
              <li>
                <span className="font-medium text-amber-600">{summary.degraded}</span>{" "}
                não enviado(s) — e-mail não configurado (RESEND_API_KEY ausente)
              </li>
            )}
            {summary.failed.map((f) => (
              <li key={f.name} className="flex items-center gap-1.5 text-red-600">
                <XCircleIcon className="size-3.5" />
                {f.name}: {f.reason}
              </li>
            ))}
            {summary.rejected.map((r) => (
              <li key={r.name} className="flex items-center gap-1.5 text-zinc-500">
                <AlertTriangleIcon className="size-3.5" />
                {r.name}: {r.reason} (não enviado)
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Selecionar todos"
                />
              </th>
              <th className="px-4 py-3">Motorista</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Vencimento da CNH</th>
              <th className="px-4 py-3">Última cobrança</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {drivers.map((d) => {
              const isSelected = selected.has(d.userId);
              return (
                <tr
                  key={d.userId}
                  className={isSelected ? "bg-emerald-50/40" : "hover:bg-zinc-50"}
                >
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(d.userId)}
                      aria-label={`Selecionar ${d.name}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-zinc-900">{d.name}</span>
                    {d.userId === currentUserId && (
                      <Badge variant="muted" className="ml-2 text-[10px]">você</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{d.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangleIcon className="size-3" />
                      {formatDate(d.cnhExpiration)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <ClockIcon className="size-3" />
                      {formatDateTime(d.lastCollectedAt)}
                    </div>
                  </td>
                </tr>
              );
            })}
            {drivers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">
                  Nenhum motorista ativo com CNH vencida.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400">
        {drivers.length} motorista(s) com CNH vencida. O reenvio é permitido —
        cada cobrança fica registrada com data/hora e autor.
      </p>
    </div>
  );
}
