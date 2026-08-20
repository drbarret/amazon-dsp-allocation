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
  LayoutGridIcon,
  CalendarOffIcon,
  Loader2Icon,
  Building2Icon,
  PencilIcon,
  CheckIcon,
  AlertCircleIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { WeekSelector } from "@/components/week-selector";
import { EmptyState } from "@/components/empty-state";
import {
  listVacancyBlocks,
  saveBlockWeek,
  updateVacancyBlock,
  type VacancyBlockRow,
} from "./actions";
import type { UserRole, VehicleEligibility } from "@/generated/prisma";

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

const VEHICLE_LABELS: Record<VehicleEligibility, string> = {
  GNV: "GNV",
  CARGO_VAN: "Cargo Van",
  PASSENGER: "Passenger",
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function VagasClient({
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

  const [blocks, setBlocks] = useState<VacancyBlockRow[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Draft counts per block (7 positions)
  const [drafts, setDrafts] = useState<Record<string, number[]>>({});
  // Save status per block
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});

  // Edit block dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<VacancyBlockRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    cycle: 1 as number,
    shift: "",
    active: true,
    eligibleVehicleTypes: [] as VehicleEligibility[],
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const selectedWeek = useMemo(
    () => filteredWeeks.find((w) => w.id === selectedWeekId) ?? null,
    [filteredWeeks, selectedWeekId]
  );

  useEffect(() => {
    loadBlocks(selectedWeekId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekId]);

  function loadBlocks(weekId: string) {
    if (!weekId) {
      setBlocks([]);
      setDrafts({});
      setSaveStatuses({});
      return;
    }
    setLoadingBlocks(true);
    startTransition(async () => {
      try {
        const result = await listVacancyBlocks(weekId, effectiveTransportCompanyId);
        if (result.success) {
          setBlocks(result.blocks);
          // Initialize drafts from server data
          const newDrafts: Record<string, number[]> = {};
          const newStatuses: Record<string, SaveStatus> = {};
          for (const b of result.blocks) {
            const counts = Array(7).fill(0);
            for (const dv of b.dailyVacancies) {
              counts[dv.dayOfWeek] = dv.count;
            }
            newDrafts[b.id] = counts;
            newStatuses[b.id] = "idle";
          }
          setDrafts(newDrafts);
          setSaveStatuses(newStatuses);
        } else {
          toast.error(result.error ?? "Erro ao carregar blocos.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar blocos.");
      } finally {
        setLoadingBlocks(false);
      }
    });
  }

  function handleCountChange(blockId: string, dayIndex: number, value: string) {
    const parsed = parseInt(value, 10);
    const count = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setDrafts((prev) => {
      const current = prev[blockId] ?? Array(7).fill(0);
      const next = [...current];
      next[dayIndex] = count;
      return { ...prev, [blockId]: next };
    });
    // Mark as unsaved (clear saved/error status)
    setSaveStatuses((prev) => ({
      ...prev,
      [blockId]: prev[blockId] === "saved" ? "idle" : prev[blockId],
    }));
  }

  function handleSaveBlock(block: VacancyBlockRow) {
    const counts = drafts[block.id] ?? Array(7).fill(0);
    setSaveStatuses((prev) => ({ ...prev, [block.id]: "saving" }));
    startTransition(async () => {
      try {
        const result = await saveBlockWeek(
          block.id,
          selectedWeekId,
          counts,
          effectiveTransportCompanyId
        );
        if (result.success) {
          setSaveStatuses((prev) => ({ ...prev, [block.id]: "saved" }));
          // Update blocks total
          setBlocks((prev) =>
            prev.map((b) =>
              b.id === block.id
                ? { ...b, dailyVacancies: counts.map((c, i) => ({ dayOfWeek: i, count: c })), total: counts.reduce((a, b) => a + b, 0) }
                : b
            )
          );
          // Clear saved status after 2s
          setTimeout(() => {
            setSaveStatuses((prev) => ({
              ...prev,
              [block.id]: prev[block.id] === "saved" ? "idle" : prev[block.id],
            }));
          }, 2000);
        } else {
          setSaveStatuses((prev) => ({ ...prev, [block.id]: "error" }));
          toast.error(result.error ?? "Erro ao salvar.");
        }
      } catch (e) {
        setSaveStatuses((prev) => ({ ...prev, [block.id]: "error" }));
        toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  function openEditDialog(block: VacancyBlockRow) {
    setEditingBlock(block);
    setEditForm({
      name: block.name,
      cycle: block.cycle,
      shift: block.shift ?? "",
      active: block.active,
      eligibleVehicleTypes: [...block.eligibleVehicleTypes],
    });
    setEditDialogOpen(true);
  }

  function toggleEligibility(type: VehicleEligibility) {
    setEditForm((prev) => {
      const has = prev.eligibleVehicleTypes.includes(type);
      return {
        ...prev,
        eligibleVehicleTypes: has
          ? prev.eligibleVehicleTypes.filter((t) => t !== type)
          : [...prev.eligibleVehicleTypes, type],
      };
    });
  }

  function handleSaveEdit() {
    if (!editingBlock) return;
    if (editForm.eligibleVehicleTypes.length === 0) {
      toast.error("Selecione pelo menos um tipo de veículo.");
      return;
    }
    setIsSavingEdit(true);
    startTransition(async () => {
      try {
        const result = await updateVacancyBlock(
          editingBlock.id,
          {
            name: editForm.name,
            cycle: editForm.cycle,
            shift: editForm.shift || null,
            active: editForm.active,
            eligibleVehicleTypes: editForm.eligibleVehicleTypes,
          },
          effectiveTransportCompanyId
        );
        if (result.success) {
          toast.success("Bloco atualizado.");
          setEditDialogOpen(false);
          setEditingBlock(null);
          loadBlocks(selectedWeekId);
        } else {
          toast.error(result.error ?? "Erro ao atualizar bloco.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao atualizar bloco.");
      } finally {
        setIsSavingEdit(false);
      }
    });
  }

  // Compute total from draft (live)
  function getBlockTotal(blockId: string): number {
    const d = drafts[blockId];
    if (!d) return 0;
    return d.reduce((sum, v) => sum + v, 0);
  }

  // Check if draft differs from saved
  function isDirty(block: VacancyBlockRow): boolean {
    const d = drafts[block.id];
    if (!d) return false;
    const saved = Array(7).fill(0);
    for (const dv of block.dailyVacancies) {
      saved[dv.dayOfWeek] = dv.count;
    }
    return d.some((v, i) => v !== saved[i]);
  }

  if (!hasTransportCompany && !canSelectCompany) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <PageHeader title="Vagas por Bloco" />
        <EmptyState
          icon={LayoutGridIcon}
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
          title="Vagas por Bloco"
          description="Defina a quantidade de vagas aprovadas pela Amazon para cada bloco e dia da semana."
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
        title="Vagas por Bloco"
        description="Defina a quantidade de vagas aprovadas pela Amazon para cada bloco e dia da semana."
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
              disabled={isPending || loadingBlocks}
            />
          </div>
        }
      />

      {selectedWeek && (
        <p className="text-sm text-muted-foreground">
          {selectedWeek.startDate} a {selectedWeek.endDate}
        </p>
      )}

      {loadingBlocks ? (
        <div className="flex items-center justify-center py-12">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : blocks.length === 0 ? (
        <EmptyState
          icon={LayoutGridIcon}
          title="Nenhum bloco cadastrado"
          hint="Os blocos padrão são criados automaticamente. Se esta lista estiver vazia, entre em contato com o administrador."
        />
      ) : (
        <div className="space-y-4">
          {blocks.map((block) => {
            const status = saveStatuses[block.id] ?? "idle";
            const dirty = isDirty(block);
            const total = getBlockTotal(block.id);

            return (
              <div
                key={block.id}
                className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
              >
                {/* Header do card */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-base font-semibold text-heading sm:text-lg">
                      {block.name}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {/* Elegibilidade */}
                      <Badge variant="outline" className="break-all whitespace-normal">
                        {block.eligibleVehicleTypes
                          .map((t) => VEHICLE_LABELS[t] ?? t)
                          .join(", ")}
                      </Badge>
                      {/* Ciclo */}
                      <Badge variant="default" className="shrink-0">
                        Ciclo {block.cycle}
                        {block.shift ? ` - ${block.shift}` : ""}
                      </Badge>
                      {/* Escala */}
                      {block.shift && (
                        <Badge variant="warning" className="shrink-0">
                          Escala: Sim
                        </Badge>
                      )}
                      {/* Total */}
                      <Badge variant="success" className="shrink-0">
                        {total} vaga{total !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(block)}
                    disabled={isPending}
                    className="shrink-0"
                  >
                    <PencilIcon className="mr-1.5 size-3.5" />
                    Editar Bloco
                  </Button>
                </div>

                {/* Grade de 7 dias */}
                <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7 sm:gap-3">
                  {DAY_LABELS.map((label, idx) => (
                    <div key={label} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground text-center">
                        {label}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={drafts[block.id]?.[idx] ?? 0}
                        onChange={(e) => handleCountChange(block.id, idx, e.target.value)}
                        onBlur={(e) => {
                          // Clamp on blur
                          const v = parseInt(e.target.value, 10);
                          if (Number.isNaN(v) || v < 0) {
                            handleCountChange(block.id, idx, "0");
                          }
                        }}
                        disabled={isPending}
                        className="h-9 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        aria-label={`${label} - ${block.name}`}
                      />
                    </div>
                  ))}
                </div>

                {/* Botão salvar + feedback */}
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleSaveBlock(block)}
                    disabled={isPending || status === "saving" || !dirty}
                  >
                    {status === "saving" ? (
                      <>
                        <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      "Salvar"
                    )}
                  </Button>
                  {status === "saved" && (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckIcon className="size-3.5" />
                      Salvo
                    </span>
                  )}
                  {status === "error" && (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <AlertCircleIcon className="size-3.5" />
                      Erro ao salvar
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog Editar Bloco */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogHeader>
          <DialogTitle>Editar Bloco</DialogTitle>
          <DialogDescription>
            Altere os metadados do bloco{" "}
            <strong>{editingBlock?.name}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nome</Label>
            <Input
              id="edit-name"
              value={editForm.name}
              onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
              disabled={isSavingEdit}
            />
          </div>
          <div className="space-y-2">
            <Label>Elegibilidade de Veículo</Label>
            <div className="flex flex-wrap gap-2">
              {(["GNV", "CARGO_VAN", "PASSENGER"] as VehicleEligibility[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleEligibility(type)}
                  disabled={isSavingEdit}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    editForm.eligibleVehicleTypes.includes(type)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {VEHICLE_LABELS[type]}
                </button>
              ))}
            </div>
            {editForm.eligibleVehicleTypes.length === 0 && (
              <p className="text-xs text-destructive">Selecione pelo menos um tipo.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-cycle">Ciclo</Label>
              <select
                id="edit-cycle"
                value={editForm.cycle}
                onChange={(e) => setEditForm((prev) => ({ ...prev, cycle: Number(e.target.value) }))}
                disabled={isSavingEdit}
                className="h-9 w-full rounded-lg border border-border bg-card px-3 py-1 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value={1}>Ciclo 1</option>
                <option value={2}>Ciclo 2</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-shift">Turno / Escala</Label>
              <Input
                id="edit-shift"
                placeholder="Ex.: Manhã"
                value={editForm.shift}
                onChange={(e) => setEditForm((prev) => ({ ...prev, shift: e.target.value }))}
                disabled={isSavingEdit}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="edit-active"
              checked={editForm.active}
              onChange={(e) => setEditForm((prev) => ({ ...prev, active: e.target.checked }))}
              disabled={isSavingEdit}
              className="size-4 cursor-pointer accent-primary"
            />
            <Label htmlFor="edit-active" className="cursor-pointer">
              Bloco ativo
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setEditDialogOpen(false);
              setEditingBlock(null);
            }}
            disabled={isSavingEdit}
          >
            Cancelar
          </Button>
          <Button onClick={handleSaveEdit} disabled={isSavingEdit}>
            {isSavingEdit ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar Alterações"
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
      <label htmlFor="company-selector-vagas" className="text-sm font-medium text-foreground">
        Transportadora
      </label>
      <select
        id="company-selector-vagas"
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
