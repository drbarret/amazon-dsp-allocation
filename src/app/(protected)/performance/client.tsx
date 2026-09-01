"use client";

import * as React from "react";
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
  UploadIcon,
  TrophyIcon,
  CalendarOffIcon,
  Loader2Icon,
  Building2Icon,
  Trash2Icon,
  LockIcon,
  PackageIcon,
  PercentIcon,
  XIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActionBar } from "@/components/action-bar";
import { WeekSelector } from "@/components/week-selector";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/status-pill";
import { getPreviousIsoWeek } from "@/lib/week-utils";
import {
  importPerformanceCsv,
  listPerformanceSnapshots,
  clearPerformanceWeek,
  type PerformanceSnapshotRow,
  type ImportPerformanceResult,
} from "./actions";
import type { UserRole, ScorecardClassification } from "@/generated/prisma";

interface WeekOption {
  id: string;
  weekKey: string;
  year: number;
  weekNumber: number;
  startDate: string;
  endDate: string;
  transportCompanyId: string;
  status: string;
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

const MANAGEMENT_ROLES: UserRole[] = ["ADMIN", "ACCOUNT_MANAGER"];

const CLASSIFICATION_LABELS: Record<ScorecardClassification, string> = {
  FANTASTIC_PLUS: "Fantástico Plus",
  FANTASTIC: "Fantástico",
  GREAT: "Bom",
  FAIR: "Razoável",
  POOR: "Ruim",
};

const CLASSIFICATION_TONE: Record<
  ScorecardClassification,
  "success" | "info" | "warning" | "danger" | "neutral" | "purple"
> = {
  FANTASTIC_PLUS: "success",
  FANTASTIC: "info",
  GREAT: "neutral",
  FAIR: "warning",
  POOR: "danger",
};

function formatDcr(dcr: number): string {
  return `${(dcr * 100).toFixed(0)}%`;
}

export function PerformanceClient({
  weeks,
  initialWeekId,
  hasTransportCompany,
  companies,
  userRole,
}: Props) {
  const canSelectCompany =
    !hasTransportCompany && MANAGEMENT_ROLES.includes(userRole);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | "">(
    () => {
      if (!canSelectCompany) return "";
      const initialWeek = weeks.find((w) => w.id === initialWeekId);
      return initialWeek?.transportCompanyId ?? companies[0]?.id ?? "";
    },
  );

  const filteredWeeks = useMemo(() => {
    if (!canSelectCompany || !selectedCompanyId) return weeks;
    return weeks.filter((w) => w.transportCompanyId === selectedCompanyId);
  }, [weeks, canSelectCompany, selectedCompanyId]);

  const [selectedWeekId, setSelectedWeekId] = useState<string>(initialWeekId);

  const setSelectedCompanyId = (companyId: string) => {
    setSelectedCompanyIdState(companyId);
    const companyWeeks = companyId
      ? weeks.filter((w) => w.transportCompanyId === companyId)
      : weeks;
    const previousIsoWeek = getPreviousIsoWeek();
    const previousWeek = companyWeeks.find(
      (w) =>
        w.year === previousIsoWeek.year &&
        w.weekNumber === previousIsoWeek.weekNumber,
    );
    setSelectedWeekId(previousWeek?.id ?? companyWeeks[0]?.id ?? "");
  };

  const effectiveTransportCompanyId = useMemo(() => {
    if (hasTransportCompany) return undefined;
    return selectedCompanyId || undefined;
  }, [hasTransportCompany, selectedCompanyId]);

  const [rows, setRows] = useState<PerformanceSnapshotRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ImportPerformanceResult | null>(
    null,
  );
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const selectedWeek = useMemo(
    () => filteredWeeks.find((w) => w.id === selectedWeekId) ?? null,
    [filteredWeeks, selectedWeekId],
  );

  const isSelectedWeekClosed = selectedWeek?.status === "CLOSED";

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
        const result = await listPerformanceSnapshots(
          weekId,
          effectiveTransportCompanyId,
        );
        if (result.success) {
          setRows(result.rows);
        } else {
          toast.error(result.error ?? "Erro ao carregar performance.");
        }
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Erro ao carregar performance.",
        );
      } finally {
        setLoadingRows(false);
      }
    });
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
        formData.append("dispatchWeekId", selectedWeekId);
        formData.append("file", file);
        if (effectiveTransportCompanyId) {
          formData.append("transportCompanyId", effectiveTransportCompanyId);
        }
        const result = await importPerformanceCsv(formData);
        setLastResult(result);
        if (result.success) {
          toast.success(`Importado: ${result.imported} motorista(s).`);
        } else {
          toast.error(
            result.error ?? `Importado com ${result.errors.length} erro(s).`,
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

  function handleClearWeek() {
    if (!selectedWeekId) {
      toast.error("Selecione uma semana.");
      return;
    }
    setIsClearing(true);
    startTransition(async () => {
      try {
        const result = await clearPerformanceWeek(
          selectedWeekId,
          effectiveTransportCompanyId,
        );
        if (result.success) {
          toast.success(`${result.deleted} importação(ões) removida(s).`);
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

  const columns: DataTableColumn<PerformanceSnapshotRow>[] = [
    {
      header: "Motorista",
      sticky: true,
      className: "min-w-0",
      cell: (d) => (
        <div className="min-w-0">
          <div className="text-foreground truncate font-medium">{d.name}</div>
          <div className="text-muted-foreground truncate font-mono text-xs">
            {d.transporterId}
          </div>
        </div>
      ),
    },
    {
      header: "Score",
      className: "whitespace-nowrap",
      cell: (d) => (
        <span className="font-semibold">{d.scoreText ?? "-"}</span>
      ),
    },
    {
      header: "Pacotes",
      className: "text-right whitespace-nowrap",
      cell: (d) => <span>{d.deliveredPackages}</span>,
    },
    {
      header: "DCR",
      className: "text-right whitespace-nowrap",
      cell: (d) => <span>{formatDcr(d.dcr)}</span>,
    },
    {
      header: "Insucessos",
      className: "text-right whitespace-nowrap",
      cell: (d) => (
        <span className="text-destructive font-semibold">
          {d.insucessos.toFixed(2)}
        </span>
      ),
    },
    {
      header: "DNR",
      className: "text-right whitespace-nowrap",
      cell: (d) => <span>{d.dnr}</span>,
    },
    {
      header: "Contact",
      className: "text-right whitespace-nowrap",
      cell: (d) => <span>{formatDcr(d.contactCompliance)}</span>,
    },
    {
      header: "Swipe",
      className: "text-right whitespace-nowrap",
      cell: (d) => <span>{formatDcr(d.swipeToFinishCompliance)}</span>,
    },
    {
      header: "100% WHC",
      className: "text-center whitespace-nowrap",
      cell: (d) => (
        <span
          className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium ${
            d.whc100
              ? "bg-success-bg text-success-fg"
              : "bg-danger-bg text-danger-fg"
          }`}
        >
          {d.whc100 ? "Sim" : "Não"}
        </span>
      ),
    },
    {
      header: "Desempenho",
      className: "whitespace-nowrap",
      cell: (d) => (
        <StatusPill tone={CLASSIFICATION_TONE[d.classification]}>
          {CLASSIFICATION_LABELS[d.classification]}
        </StatusPill>
      ),
    },
  ];

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const totalPackages = rows.reduce((acc, r) => acc + r.deliveredPackages, 0);
    const totalInsucessos = rows.reduce((acc, r) => acc + r.insucessos, 0);
    const avgDcr = rows.reduce((acc, r) => acc + r.dcr, 0) / rows.length;
    const whcCount = rows.filter((r) => r.whc100).length;
    return { totalPackages, totalInsucessos, avgDcr, whcCount };
  }, [rows]);

  if (!hasTransportCompany && !canSelectCompany) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <PageHeader title="Performance" />
        <EmptyState
          icon={TrophyIcon}
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
          title="Performance"
          description="Importar e acompanhar a performance dos motoristas."
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
          title="Nenhuma semana anterior disponível"
          hint="Aguarde a criação automática da próxima semana."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Performance"
        description="Importar e acompanhar a performance dos motoristas."
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
          onClick={() => setDialogOpen(true)}
          disabled={isImporting || !selectedWeekId || isSelectedWeekClosed}
          title={
            isSelectedWeekClosed
              ? "Semana fechada — importação desabilitada"
              : undefined
          }
        >
          <UploadIcon className="mr-2 size-4" />
          Importar performance (.xlsx)
        </Button>
        <Button
          variant="destructive"
          onClick={() => setClearDialogOpen(true)}
          disabled={
            isClearing ||
            !selectedWeekId ||
            rows.length === 0 ||
            isSelectedWeekClosed
          }
          title={
            isSelectedWeekClosed
              ? "Semana fechada — limpeza desabilitada"
              : undefined
          }
        >
          <Trash2Icon className="mr-2 size-4" />
          Limpar semana
        </Button>
      </ActionBar>

      {isSelectedWeekClosed && (
        <div className="border-border bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-lg border p-3 text-sm">
          <LockIcon className="size-4 shrink-0" />
          <span>
            Esta semana está <strong>FECHADA</strong>. Importação e limpeza de
            performance estão desabilitadas.
          </span>
        </div>
      )}

      {lastResult && (
        <div className="border-border bg-card rounded-xl border p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={lastResult.success ? "success" : "warning"}>
              {lastResult.success ? "Sucesso" : "Atenção"}
            </Badge>
            <span className="text-muted-foreground text-sm">
              Semana {lastResult.weekKey}: {lastResult.imported} importado(s),{" "}
              {lastResult.skipped} ignorado(s), {lastResult.errors.length}{" "}
              erro(s).
            </span>
          </div>
          {lastResult.errors.length > 0 && (
            <ul className="text-destructive mt-2 space-y-1 text-sm">
              {lastResult.errors.slice(0, 10).map((err, idx) => (
                <li key={`${err.row}-${idx}`}>
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

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={PackageIcon}
            label="Pacotes entregues"
            value={summary.totalPackages.toLocaleString("pt-BR")}
          />
          <SummaryCard
            icon={XIcon}
            label="Insucessos"
            value={summary.totalInsucessos.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            tone="danger"
          />
          <SummaryCard
            icon={PercentIcon}
            label="DCR médio"
            value={formatDcr(summary.avgDcr)}
          />
          <SummaryCard
            icon={PackageIcon}
            label="100% WHC"
            value={`${summary.whcCount} / ${rows.length}`}
          />
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-heading text-lg font-semibold">
            Performance importada
          </h2>
          {selectedWeek && (
            <Badge variant="muted">{rows.length} motorista(s)</Badge>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loadingRows}
          ariaLabel="Performance importada"
          empty={{
            icon: TrophyIcon,
            title: "Nenhuma performance importada para esta semana",
            hint: "Importe o arquivo CSV da Amazon para visualizar os dados.",
          }}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>Importar performance</DialogTitle>
          <DialogDescription>
            Selecione o arquivo XLSX da Amazon para a semana{" "}
            <strong>{selectedWeek?.weekKey}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="performance-file">Arquivo .xlsx</Label>
            <Input
              id="performance-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={isImporting}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            A planilha deve conter as colunas: Nome, Transporter ID, Score,
            Pacotes Entregues, DCR, Insucessos, DNR DPMO, Contact Compliance,
            Swipe to Finish Compliance, 100% WHC.
          </p>
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
            Tem certeza que deseja remover todas as performances importadas para
            a semana <strong>{selectedWeek?.weekKey}</strong>? Essa ação não
            pode ser desfeita, mas a semana em si permanecerá cadastrada.
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
      <p className="text-muted-foreground text-sm">
        Nenhuma transportadora cadastrada
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Building2Icon className="text-muted-foreground size-4" />
      <label
        htmlFor="company-selector"
        className="text-foreground text-sm font-medium"
      >
        Transportadora
      </label>
      <select
        id="company-selector"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-border bg-card text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-32 flex-1 rounded-lg border px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-3 sm:flex-none"
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

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className="border-border bg-card flex items-center gap-3 rounded-xl border p-4 shadow-sm">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] ${
          tone === "danger"
            ? "bg-danger-bg text-danger-fg"
            : "bg-neutral-bg text-neutral-fg"
        }`}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="text-muted-foreground block text-xs">{label}</span>
        <span className="text-foreground block text-lg font-semibold">
          {value}
        </span>
      </span>
    </div>
  );
}
