"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FileDownIcon,
  UploadIcon,
  UsersIcon,
  CalendarOffIcon,
  AlertTriangleIcon,
  CheckIcon,
  XIcon,
  Loader2Icon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActionBar } from "@/components/action-bar";
import { WeekSelector } from "@/components/week-selector";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { downloadAvailabilityTemplate } from "@/lib/availability/template";
import {
  importAvailability,
  listAvailabilities,
  approveAvailability,
  rejectAvailability,
  type AvailabilityRow,
  type ImportAvailabilityResult,
} from "./actions";

interface WeekOption {
  id: string;
  weekKey: string;
  startDate: string;
  endDate: string;
}

interface Props {
  weeks: WeekOption[];
  initialWeekId: string;
  hasTransportCompany: boolean;
}

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function DayCell({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-success/15 text-success text-xs font-medium">
      S
    </span>
  ) : (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-medium">
      —
    </span>
  );
}

export function DisponibilidadesClient({
  weeks,
  initialWeekId,
  hasTransportCompany,
}: Props) {
  const [selectedWeekId, setSelectedWeekId] = useState<string>(initialWeekId);
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ImportAvailabilityResult | null>(null);

  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const selectedWeek = useMemo(
    () => weeks.find((w) => w.id === selectedWeekId) ?? null,
    [weeks, selectedWeekId],
  );

  useEffect(() => {
    loadRows(selectedWeekId);
  }, [selectedWeekId]);

  function loadRows(weekId: string) {
    if (!weekId) {
      setRows([]);
      return;
    }
    setLoadingRows(true);
    startTransition(async () => {
      try {
        const result = await listAvailabilities(weekId);
        if (result.success) {
          setRows(result.rows);
        } else {
          toast.error(result.error ?? "Erro ao carregar disponibilidades.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar disponibilidades.");
      } finally {
        setLoadingRows(false);
      }
    });
  }

  function handleDownloadTemplate() {
    const { buffer, filename } = downloadAvailabilityTemplate();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Modelo baixado.");
  }

  function handleImport() {
    if (!selectedWeekId || !file) {
      toast.error("Selecione uma semana e um arquivo.");
      return;
    }
    setIsImporting(true);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("week", selectedWeek?.weekKey ?? selectedWeekId);
        formData.append("file", file);
        const result = await importAvailability(formData);
        setLastResult(result);
        if (result.success) {
          toast.success(
            `Importado: ${result.imported} ativo(s), ${result.pendingApproval} pendente(s).`,
          );
        } else {
          toast.error(
            result.error ??
              `Importado com ${result.errors.length} erro(s).`,
          );
        }
        setDialogOpen(false);
        setFile(null);
        loadRows(selectedWeekId);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao importar.");
      } finally {
        setIsImporting(false);
      }
    });
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      try {
        const result = await approveAvailability(id, reviewNotes[id]);
        if (result.success) {
          toast.success("Motorista aprovado.");
          loadRows(selectedWeekId);
        } else {
          toast.error(result.error ?? "Erro ao aprovar.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao aprovar.");
      }
    });
  }

  function handleReject(id: string) {
    startTransition(async () => {
      try {
        const result = await rejectAvailability(id, reviewNotes[id]);
        if (result.success) {
          toast.success("Motorista rejeitado.");
          loadRows(selectedWeekId);
        } else {
          toast.error(result.error ?? "Erro ao rejeitar.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao rejeitar.");
      }
    });
  }

  const availabilityColumns: DataTableColumn<AvailabilityRow>[] = [
    {
      header: "Motorista",
      sticky: true,
      className: "min-w-0",
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <UsersIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">
              {d.name ?? "—"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {d.email}
            </span>
          </span>
        </span>
      ),
    },
    ...DAY_LABELS.map(
      (label, idx): DataTableColumn<AvailabilityRow> => ({
        header: label,
        className: "text-center",
        cell: (d) => (
          <div className="flex justify-center">
            <DayCell
              value={[
                d.sunAvailable,
                d.monAvailable,
                d.tueAvailable,
                d.wedAvailable,
                d.thuAvailable,
                d.friAvailable,
                d.satAvailable,
              ][idx]}
            />
          </div>
        ),
      }),
    ),
    {
      header: "GNV",
      className: "text-center",
      cell: (d) => (
        <div className="flex justify-center">
          <DayCell value={d.hasNaturalGas} />
        </div>
      ),
    },
    {
      header: "Passenger",
      className: "text-center",
      cell: (d) => (
        <div className="flex justify-center">
          <DayCell value={d.isPassengerCar} />
        </div>
      ),
    },
    {
      header: "Speed Tarde",
      className: "text-center",
      cell: (d) => (
        <div className="flex justify-center">
          <DayCell value={d.speedAfternoon} />
        </div>
      ),
    },
  ];

  const pendingRows = rows.filter((r) => r.approval?.status === "PENDING");

  if (!hasTransportCompany) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <PageHeader title="Disponibilidades" />
        <EmptyState
          icon={UsersIcon}
          title="Usuário sem transportadora"
          hint="Seu usuário não está vinculado a uma transportadora. Entre em contato com o administrador."
        />
      </div>
    );
  }

  if (weeks.length === 0) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <PageHeader
          title="Disponibilidades"
          description="Importar e gerenciar disponibilidades dos motoristas."
        />
        <EmptyState
          icon={CalendarOffIcon}
          title="Nenhuma semana cadastrada"
          hint="Ainda não existe nenhuma semana cadastrada para a sua transportadora."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Disponibilidades"
        description="Importar e gerenciar disponibilidades dos motoristas."
        actions={
          <WeekSelector
            weeks={weeks}
            value={selectedWeekId}
            onChange={setSelectedWeekId}
            disabled={isPending || isImporting}
          />
        }
      />

      <ActionBar>
        <Button
          variant="outline"
          onClick={handleDownloadTemplate}
          disabled={isPending || isImporting}
        >
          <FileDownIcon className="mr-2 size-4" />
          Baixar modelo (.xlsx)
        </Button>
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={isPending || isImporting || !selectedWeekId}
        >
          <UploadIcon className="mr-2 size-4" />
          Importar disponibilidades (.xlsx)
        </Button>
      </ActionBar>

      {lastResult && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={lastResult.success ? "success" : "warning"}>
              {lastResult.success ? "Sucesso" : "Atenção"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Semana {lastResult.week}: {lastResult.imported} importado(s), {" "}
              {lastResult.pendingApproval} pendente(s), {lastResult.errors.length} erro(s).
            </span>
          </div>
          {lastResult.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-destructive">
              {lastResult.errors.slice(0, 10).map((err) => (
                <li key={`${err.row}-${err.reason}`}>
                  Linha {err.row}: {err.reason}
                </li>
              ))}
              {lastResult.errors.length > 10 && (
                <li>E mais {lastResult.errors.length - 10} erro(s)...</li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">
            Disponibilidades importadas
          </h2>
          {selectedWeek && (
            <Badge variant="muted">
              {rows.length} motorista(s)
            </Badge>
          )}
        </div>

        <DataTable
          columns={availabilityColumns}
          rows={rows}
          loading={loadingRows}
          ariaLabel="Disponibilidades importadas"
          empty={{
            icon: UsersIcon,
            title: "Nenhuma disponibilidade importada para esta semana",
            hint: "Baixe o modelo, preencha e importe o arquivo.",
          }}
        />
      </div>

      {pendingRows.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-warning-fg" />
            <h2 className="text-lg font-semibold text-heading">
              Aprovações pendentes
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Motoristas inativos que preencheram a planilha. Aprove ou rejeite
            antes de usar na alocação.
          </p>

          <DataTable
            columns={[
              {
                header: "Motorista",
                sticky: true,
                cell: (d) => (
                  <span>
                    <span className="block font-medium text-foreground">
                      {d.name ?? "—"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {d.email}
                    </span>
                  </span>
                ),
              },
              {
                header: "Observação",
                className: "min-w-[200px]",
                cell: (d) => (
                  <Input
                    placeholder="Observação opcional"
                    value={reviewNotes[d.id] ?? ""}
                    onChange={(e) =>
                      setReviewNotes((prev) => ({
                        ...prev,
                        [d.id]: e.target.value,
                      }))
                    }
                    disabled={isPending}
                  />
                ),
              },
              {
                header: "Ações",
                className: "text-right",
                cell: (d) => (
                  <span className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleApprove(d.id)}
                      disabled={isPending}
                      aria-label={`Aprovar ${d.name ?? d.email}`}
                    >
                      <CheckIcon className="mr-1 size-3.5" />
                      Aprovar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleReject(d.id)}
                      disabled={isPending}
                      aria-label={`Rejeitar ${d.name ?? d.email}`}
                    >
                      <XIcon className="mr-1 size-3.5" />
                      Rejeitar
                    </Button>
                  </span>
                ),
              },
            ]}
            rows={pendingRows}
            ariaLabel="Aprovações pendentes"
            empty={{ title: "Nenhuma aprovação pendente" }}
          />
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>Importar disponibilidades</DialogTitle>
          <DialogDescription>
            Selecione o arquivo .xlsx preenchido para a semana {" "}
            <strong>{selectedWeek?.weekKey}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="availability-file">Arquivo .xlsx</Label>
            <Input
              id="availability-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={isImporting}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setDialogOpen(false);
              setFile(null);
            }}
            disabled={isImporting}
          >
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={isImporting || !file}>
            {isImporting ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Importando...
              </>
            ) : (
              "Importar"
            )}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
