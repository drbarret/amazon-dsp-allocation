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
  Building2Icon,
  PencilIcon,
  Trash2Icon,
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
  updateAvailability,
  clearWeek,
  type AvailabilityRow,
  type ImportAvailabilityResult,
} from "./actions";
import type { UserRole } from "@/generated/prisma";

interface WeekOption {
  id: string;
  weekKey: string;
  startDate: string;
  endDate: string;
  transportCompanyId: string;
}

interface CompanyOption {
  id: string;
  name: string;
}

interface Props {
  weeks: WeekOption[];
  initialWeekId: string;
  hasTransportCompany: boolean;
  companies: CompanyOption[];
  userRole: UserRole;
}

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const MANAGEMENT_ROLES: UserRole[] = ["ADMIN", "ACCOUNT_MANAGER"];

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
  companies,
  userRole,
}: Props) {
  const canSelectCompany = !hasTransportCompany && MANAGEMENT_ROLES.includes(userRole);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | "">(
    canSelectCompany ? companies[0]?.id ?? "" : ""
  );

  const filteredWeeks = useMemo(() => {
    if (!canSelectCompany || !selectedCompanyId) return weeks;
    return weeks.filter((w) => w.transportCompanyId === selectedCompanyId);
  }, [weeks, canSelectCompany, selectedCompanyId]);

  const [selectedWeekId, setSelectedWeekId] = useState<string>(() => {
    if (canSelectCompany) {
      const companyWeeks = companies[0]?.id
        ? weeks.filter((w) => w.transportCompanyId === companies[0].id)
        : weeks;
      return companyWeeks[0]?.id ?? "";
    }
    return initialWeekId;
  });

  const setSelectedCompanyId = (companyId: string) => {
    setSelectedCompanyIdState(companyId);
    const companyWeeks = companyId
      ? weeks.filter((w) => w.transportCompanyId === companyId)
      : weeks;
    setSelectedWeekId(companyWeeks[0]?.id ?? "");
  };

  const effectiveTransportCompanyId = useMemo(() => {
    if (hasTransportCompany) return undefined;
    return selectedCompanyId || undefined;
  }, [hasTransportCompany, selectedCompanyId]);

  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ImportAvailabilityResult | null>(null);

  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<AvailabilityRow>>({});
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const selectedWeek = useMemo(
    () => filteredWeeks.find((w) => w.id === selectedWeekId) ?? null,
    [filteredWeeks, selectedWeekId]
  );

  useEffect(() => {
    loadRows(selectedWeekId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekId]);

  function loadRows(weekId: string) {
    if (!weekId) {
      setRows([]);
      return;
    }
    setLoadingRows(true);
    startTransition(async () => {
      try {
        const result = await listAvailabilities(weekId, effectiveTransportCompanyId);
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
    if (!hasTransportCompany && !selectedCompanyId) {
      toast.error("Selecione uma transportadora.");
      return;
    }
    setIsImporting(true);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("week", selectedWeek?.weekKey ?? selectedWeekId);
        formData.append("file", file);
        if (effectiveTransportCompanyId) {
          formData.append("transportCompanyId", effectiveTransportCompanyId);
        }
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
        const result = await approveAvailability(id, reviewNotes[id], effectiveTransportCompanyId);
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

  function handleUpdate(id: string) {
    startTransition(async () => {
      try {
        const result = await updateAvailability(
          id,
          {
            hasNaturalGas: editDraft.hasNaturalGas,
            isPassengerCar: editDraft.isPassengerCar,
            sunAvailable: editDraft.sunAvailable,
            monAvailable: editDraft.monAvailable,
            tueAvailable: editDraft.tueAvailable,
            wedAvailable: editDraft.wedAvailable,
            thuAvailable: editDraft.thuAvailable,
            friAvailable: editDraft.friAvailable,
            satAvailable: editDraft.satAvailable,
            speedAfternoon: editDraft.speedAfternoon,
          },
          effectiveTransportCompanyId
        );
        if (result.success) {
          toast.success("Disponibilidade atualizada.");
          setEditingRowId(null);
          loadRows(selectedWeekId);
        } else {
          toast.error(result.error ?? "Erro ao atualizar.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao atualizar.");
      }
    });
  }

  function handleClearWeek() {
    if (!selectedWeekId) {
      toast.error("Selecione uma semana.");
      return;
    }
    setIsClearing(true);
    startTransition(async () => {
      try {
        const result = await clearWeek(selectedWeekId, effectiveTransportCompanyId);
        if (result.success) {
          toast.success(`${result.deleted} disponibilidade(s) removida(s).`);
          setClearDialogOpen(false);
          loadRows(selectedWeekId);
        } else {
          toast.error(result.error ?? "Erro ao limpar semana.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao limpar semana.");
      } finally {
        setIsClearing(false);
      }
    });
  }

  function handleReject(id: string) {
    startTransition(async () => {
      try {
        const result = await rejectAvailability(id, reviewNotes[id], effectiveTransportCompanyId);
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

  function startEditing(row: AvailabilityRow) {
    setEditingRowId(row.id);
    setEditDraft({ ...row });
  }

  function cancelEditing() {
    setEditingRowId(null);
    setEditDraft({});
  }

  function toggleDraft(field: keyof AvailabilityRow) {
    setEditDraft((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
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
        cell: (d) => {
          const field = [
            "sunAvailable",
            "monAvailable",
            "tueAvailable",
            "wedAvailable",
            "thuAvailable",
            "friAvailable",
            "satAvailable",
          ][idx] as keyof AvailabilityRow;
          const isEditing = editingRowId === d.id;
          const value = isEditing ? Boolean(editDraft[field]) : [
            d.sunAvailable,
            d.monAvailable,
            d.tueAvailable,
            d.wedAvailable,
            d.thuAvailable,
            d.friAvailable,
            d.satAvailable,
          ][idx];

          if (isEditing) {
            return (
              <div className="flex justify-center">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={() => toggleDraft(field)}
                  aria-label={`${label} ${d.name ?? d.email}`}
                  className="size-4 cursor-pointer accent-primary"
                />
              </div>
            );
          }

          return (
            <div className="flex justify-center">
              <DayCell value={value} />
            </div>
          );
        },
      }),
    ),
    {
      header: "GNV",
      className: "text-center",
      cell: (d) => {
        const isEditing = editingRowId === d.id;
        const value = isEditing ? Boolean(editDraft.hasNaturalGas) : d.hasNaturalGas;
        if (isEditing) {
          return (
            <div className="flex justify-center">
              <input
                type="checkbox"
                checked={value}
                onChange={() => toggleDraft("hasNaturalGas")}
                aria-label={`GNV ${d.name ?? d.email}`}
                className="size-4 cursor-pointer accent-primary"
              />
            </div>
          );
        }
        return (
          <div className="flex justify-center">
            <DayCell value={value} />
          </div>
        );
      },
    },
    {
      header: "Passenger",
      className: "text-center",
      cell: (d) => {
        const isEditing = editingRowId === d.id;
        const value = isEditing ? Boolean(editDraft.isPassengerCar) : d.isPassengerCar;
        if (isEditing) {
          return (
            <div className="flex justify-center">
              <input
                type="checkbox"
                checked={value}
                onChange={() => toggleDraft("isPassengerCar")}
                aria-label={`Passenger ${d.name ?? d.email}`}
                className="size-4 cursor-pointer accent-primary"
              />
            </div>
          );
        }
        return (
          <div className="flex justify-center">
            <DayCell value={value} />
          </div>
        );
      },
    },
    {
      header: "Speed Tarde",
      className: "text-center",
      cell: (d) => {
        const isEditing = editingRowId === d.id;
        const value = isEditing ? Boolean(editDraft.speedAfternoon) : d.speedAfternoon;
        if (isEditing) {
          return (
            <div className="flex justify-center">
              <input
                type="checkbox"
                checked={value}
                onChange={() => toggleDraft("speedAfternoon")}
                aria-label={`Speed Tarde ${d.name ?? d.email}`}
                className="size-4 cursor-pointer accent-primary"
              />
            </div>
          );
        }
        return (
          <div className="flex justify-center">
            <DayCell value={value} />
          </div>
        );
      },
    },
    {
      header: "Ações",
      className: "text-right",
      cell: (d) => {
        const isEditing = editingRowId === d.id;
        return (
          <span className="flex items-center justify-end gap-1">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleUpdate(d.id)}
                  disabled={isPending}
                >
                  <CheckIcon className="mr-1 size-3.5" />
                  Salvar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEditing}
                  disabled={isPending}
                >
                  <XIcon className="mr-1 size-3.5" />
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startEditing(d)}
                disabled={isPending || editingRowId !== null}
                aria-label={`Editar ${d.name ?? d.email}`}
              >
                <PencilIcon className="mr-1 size-3.5" />
                Editar
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  const pendingRows = rows.filter((r) => r.approval?.status === "PENDING");

  if (!hasTransportCompany && !canSelectCompany) {
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

  if (filteredWeeks.length === 0) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <PageHeader
          title="Disponibilidades"
          description="Importar e gerenciar disponibilidades dos motoristas."
        />
        {canSelectCompany && companies.length > 0 && (
          <CompanySelector
            companies={companies}
            value={selectedCompanyId}
            onChange={setSelectedCompanyId}
          />
        )}
        <EmptyState
          icon={CalendarOffIcon}
          title="Nenhuma semana cadastrada"
          hint="Ainda não existe nenhuma semana cadastrada para a transportadora selecionada."
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
          <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
            {canSelectCompany && (
              <CompanySelector
                companies={companies}
                value={selectedCompanyId}
                onChange={setSelectedCompanyId}
              />
            )}
            <WeekSelector
              weeks={filteredWeeks}
              value={selectedWeekId}
              onChange={setSelectedWeekId}
              disabled={isPending || isImporting}
            />
          </div>
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
        <Button
          variant="destructive"
          onClick={() => setClearDialogOpen(true)}
          disabled={isPending || isImporting || !selectedWeekId || rows.length === 0}
        >
          <Trash2Icon className="mr-2 size-4" />
          Limpar semana
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
            Selecione o arquivo .xlsx preenchido para a semana{" "}
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

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogHeader>
          <DialogTitle>Limpar semana</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja remover todas as disponibilidades importadas
            para a semana <strong>{selectedWeek?.weekKey}</strong>? Essa ação
            não pode ser desfeita, mas a semana em si permanecerá cadastrada.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setClearDialogOpen(false)}
            disabled={isClearing}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleClearWeek}
            disabled={isClearing}
          >
            {isClearing ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Removendo...
              </>
            ) : (
              "Limpar semana"
            )}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function CompanySelector({
  companies,
  value,
  onChange,
}: {
  companies: CompanyOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (companies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nenhuma transportadora cadastrada</p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Building2Icon className="size-4 text-muted-foreground" />
      <label htmlFor="company-selector" className="text-sm font-medium text-foreground">
        Transportadora
      </label>
      <select
        id="company-selector"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-32 flex-1 rounded-lg border border-border bg-card px-3 py-1 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
