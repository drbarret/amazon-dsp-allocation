"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  UserPlusIcon,
  SearchIcon,
  PencilIcon,
  UsersIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusPill, type StatusPillTone } from "@/components/status-pill";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  changeUserRole,
  deactivateUser,
  reactivateUser,
  inviteUser,
  revokeInvite,
  updateDriverCnh,
  updateDriverCityPreferences,
  updateDriverVehicleType,
} from "./actions";
import type { UserRow } from "./page";
import type { UserRole } from "@/generated/prisma";

const ALLOWED_CITIES = [
  "Jundiaí",
  "Louveira",
  "Várzea Paulista",
  "Campo Limpo",
  "Itupeva",
  "Itatiba",
  "Cabreúva",
  "Vinhedo",
] as const;

const MAX_CITIES = 3;

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "ACCOUNT_MANAGER", label: "Gerente de Contas" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "DRIVER", label: "Motorista" },
];

const ROLE_PILL_TONE: Record<string, StatusPillTone> = {
  ADMIN: "purple",
  ACCOUNT_MANAGER: "info",
  SUPERVISOR: "warning",
  DRIVER: "neutral",
};

const VEHICLE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "CARGO_VAN", label: "Cargo Van" },
  { value: "LARGE_VAN", label: "Large Van" },
  { value: "PASSEIO", label: "Passeio" },
];

interface Props {
  users: UserRow[];
  currentUserId: string;
  roleLabels: Record<string, string>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UserManagementClient({ users, currentUserId, roleLabels }: Props) {
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("DRIVER");
  const [confirmAction, setConfirmAction] = useState<{
    type: "deactivate" | "reactivate" | "revoke";
    userId: string;
    userName: string;
  } | null>(null);
  const [cnhEdit, setCnhEdit] = useState<{ userId: string; userName: string; value: string } | null>(null);
  const [cityEdit, setCityEdit] = useState<{ userId: string; userName: string; selected: string[] } | null>(null);
  const [vehicleEdit, setVehicleEdit] = useState<{ userId: string; userName: string; value: string } | null>(null);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (roleLabels[u.role] ?? u.role).toLowerCase().includes(q)
    );
  });

  function handleRoleChange(targetUserId: string, newRole: UserRole) {
    startTransition(async () => {
      try {
        const result = await changeUserRole(targetUserId, newRole);
        if (result.success) {
          toast.success("Papel alterado com sucesso.");
        } else {
          toast.error(result.error ?? "Erro ao alterar papel.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao alterar papel.");
      }
    });
  }

  function handleDeactivate(userId: string) {
    startTransition(async () => {
      try {
        const result = await deactivateUser(userId);
        if (result.success) {
          toast.success("Usuário desativado.");
          setConfirmAction(null);
        } else {
          toast.error(result.error ?? "Erro ao desativar usuário.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao desativar usuário.");
      }
    });
  }

  function handleReactivate(userId: string) {
    startTransition(async () => {
      try {
        const result = await reactivateUser(userId);
        if (result.success) {
          toast.success("Usuário reativado.");
          setConfirmAction(null);
        } else {
          toast.error(result.error ?? "Erro ao reativar usuário.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao reativar usuário.");
      }
    });
  }

  function handleInvite() {
    if (!inviteEmail.trim()) {
      toast.error("Informe um e-mail.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await inviteUser(inviteEmail, inviteRole);
        if (result.success) {
          toast.success("Convite enviado com sucesso.");
          setInviteOpen(false);
          setInviteEmail("");
          setInviteRole("DRIVER");
        } else {
          toast.error(result.error ?? "Erro ao convidar usuário.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao convidar usuário.");
      }
    });
  }

  function handleRevoke(allowedEmailId: string) {
    startTransition(async () => {
      try {
        const result = await revokeInvite(allowedEmailId);
        if (result.success) {
          toast.success("Convite revogado.");
          setConfirmAction(null);
        } else {
          toast.error(result.error ?? "Erro ao revogar convite.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao revogar convite.");
      }
    });
  }

  function handleCnhSave() {
    if (!cnhEdit) return;
    startTransition(async () => {
      try {
        const result = await updateDriverCnh(cnhEdit.userId, cnhEdit.value);
        if (result.success) {
          toast.success("Data da CNH atualizada.");
          setCnhEdit(null);
        } else {
          toast.error(result.error ?? "Erro ao atualizar CNH.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao atualizar CNH.");
      }
    });
  }

  function handleCitySave() {
    if (!cityEdit) return;
    startTransition(async () => {
      try {
        const result = await updateDriverCityPreferences(
          cityEdit.userId,
          cityEdit.selected,
        );
        if (result.success) {
          toast.success("Cidades de preferência atualizadas.");
          setCityEdit(null);
        } else {
          toast.error(result.error ?? "Erro ao atualizar cidades.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao atualizar cidades.");
      }
    });
  }

  function toggleCityEdit(city: string) {
    setCityEdit((prev) => {
      if (!prev) return prev;
      if (prev.selected.includes(city)) {
        return { ...prev, selected: prev.selected.filter((c) => c !== city) };
      }
      if (prev.selected.length >= MAX_CITIES) return prev;
      return { ...prev, selected: [...prev.selected, city] };
    });
  }

  function handleVehicleSave() {
    if (!vehicleEdit) return;
    startTransition(async () => {
      try {
        const result = await updateDriverVehicleType(
          vehicleEdit.userId,
          vehicleEdit.value,
        );
        if (result.success) {
          toast.success("Categoria de veículo atualizada.");
          setVehicleEdit(null);
        } else {
          toast.error(result.error ?? "Erro ao atualizar categoria de veículo.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao atualizar categoria de veículo.");
      }
    });
  }

  function driverSummary(user: UserRow): { line1: string; line2: string } {
    const parts: string[] = [];
    if (user.cnhExpiration) {
      parts.push(`CNH ${formatDate(user.cnhExpiration)}`);
    }
    if (user.vehicleType) {
      parts.push(
        VEHICLE_TYPE_OPTIONS.find((o) => o.value === user.vehicleType)?.label ??
          user.vehicleType,
      );
    }
    const line1 = parts.join(" · ");
    const line2 =
      user.cityPreferences && user.cityPreferences.length > 0
        ? user.cityPreferences.join(", ")
        : "";
    return { line1, line2 };
  }

  const columns: DataTableColumn<UserRow>[] = [
    {
      header: "Usuário",
      sticky: true,
      className: "min-w-0",
      cell: (user) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {user.name}
            </span>
            {user.id === currentUserId && (
              <StatusPill tone="neutral">você</StatusPill>
            )}
            {user.source === "invite" && (
              <StatusPill tone="warning">convite</StatusPill>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {user.email}
          </div>
        </div>
      ),
    },
    {
      header: "Papel",
      className: "whitespace-nowrap",
      cell: (user) =>
        user.source === "user" ? (
          <Select
            value={user.role}
            onValueChange={(v) => handleRoleChange(user.id, v as UserRole)}
            disabled={isPending}
          >
            <SelectTrigger
              size="sm"
              className="w-36"
              aria-label={`Papel de ${user.name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <StatusPill tone={ROLE_PILL_TONE[user.role] ?? "neutral"}>
            {roleLabels[user.role] ?? user.role}
          </StatusPill>
        ),
    },
    {
      header: "Motorista",
      className: "min-w-0",
      cell: (user) => {
        if (user.source !== "user" || user.role !== "DRIVER") {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const { line1, line2 } = driverSummary(user);
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs text-muted-foreground">
                {line1 || "—"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-1.5"
                onClick={() =>
                  setCnhEdit({
                    userId: user.id,
                    userName: user.name,
                    value: user.cnhExpiration
                      ? new Date(user.cnhExpiration).toISOString().slice(0, 10)
                      : "",
                  })
                }
                disabled={isPending}
                aria-label={`Editar dados do motorista ${user.name}`}
              >
                <PencilIcon className="size-3.5 text-muted-foreground" />
              </Button>
            </div>
            {line2 && (
              <div className="truncate text-xs text-muted-foreground">
                {line2}
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: "Último acesso",
      className: "whitespace-nowrap tabular-nums",
      cell: (user) =>
        user.lastLoginAt ? (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(user.lastLoginAt)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Nunca acessou</span>
        ),
    },
    {
      header: "Status",
      className: "whitespace-nowrap",
      cell: (user) =>
        user.active ? (
          <StatusPill tone="success">Ativo</StatusPill>
        ) : (
          <StatusPill tone="neutral">
            {user.source === "invite" && user.allowedEmailStatus === "REVOKED"
              ? "Revogado"
              : "Inativo"}
          </StatusPill>
        ),
    },
    {
      header: "Ações",
      className: "whitespace-nowrap text-right",
      cell: (user) => (
        <div className="flex items-center justify-end gap-1">
          {user.source === "user" && user.role === "DRIVER" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setCityEdit({
                    userId: user.id,
                    userName: user.name,
                    selected: user.cityPreferences ?? [],
                  })
                }
                disabled={isPending}
                aria-label={`Editar cidades de ${user.name}`}
              >
                Cidades
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setVehicleEdit({
                    userId: user.id,
                    userName: user.name,
                    value: user.vehicleType ?? "CARGO_VAN",
                  })
                }
                disabled={isPending}
                aria-label={`Editar veículo de ${user.name}`}
              >
                Veículo
              </Button>
            </>
          )}
          {user.source === "user" ? (
            user.active ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  setConfirmAction({
                    type: "deactivate",
                    userId: user.id,
                    userName: user.name,
                  })
                }
                disabled={isPending || user.id === currentUserId}
                aria-label={`Desativar ${user.name}`}
              >
                Desativar
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setConfirmAction({
                    type: "reactivate",
                    userId: user.id,
                    userName: user.name,
                  })
                }
                disabled={isPending}
                aria-label={`Reativar ${user.name}`}
              >
                Reativar
              </Button>
            )
          ) : user.allowedEmailStatus === "ACTIVE" ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                setConfirmAction({
                  type: "revoke",
                  userId: user.allowedEmailId!,
                  userName: user.email,
                })
              }
              disabled={isPending}
              aria-label={`Revogar convite de ${user.email}`}
            >
              Revogar
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Usuários"
        description="Gerenciar papéis, acesso e dados do motorista."
        actions={
          <Button onClick={() => setInviteOpen(true)} disabled={isPending}>
            <UserPlusIcon className="mr-2 size-4" />
            Convidar usuário
          </Button>
        }
      />

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, e-mail ou papel..."
          aria-label="Buscar usuário"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        dense
        ariaLabel="Usuários do sistema"
        empty={{
          icon: UsersIcon,
          title: search
            ? "Nenhum usuário encontrado para esta busca"
            : "Nenhum usuário cadastrado",
          hint: search
            ? "Limpe a busca ou ajuste os critérios para ver mais resultados."
            : "Convide o primeiro usuário para começar.",
        }}
      />

      <p className="text-xs text-muted-foreground">
        Mostrando {filtered.length} de {users.length} usuários
        {search ? " (filtrado)" : ""}
      </p>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogHeader>
          <DialogTitle>Convidar Usuário</DialogTitle>
          <DialogDescription>
            Adicione um e-mail à lista de acesso autorizado. O usuário poderá
            fazer login com sua conta Amazon.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="nome@exemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Papel</Label>
            <Select
              value={inviteRole}
              onValueChange={(v) => setInviteRole(v as UserRole)}
            >
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setInviteOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleInvite} disabled={isPending}>
            {isPending ? "Convidando..." : "Convidar"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction?.type === "deactivate"
            ? "Desativar usuário"
            : confirmAction?.type === "reactivate"
              ? "Reativar usuário"
              : "Revogar convite"
        }
        description={
          confirmAction?.type === "deactivate"
            ? `Tem certeza que deseja desativar ${confirmAction?.userName}? O usuário não poderá fazer login até ser reativado.`
            : confirmAction?.type === "reactivate"
              ? `Tem certeza que deseja reativar ${confirmAction?.userName}? O usuário voltará a ter acesso ao sistema.`
              : `Tem certeza que deseja revogar o convite de ${confirmAction?.userName}? O e-mail não poderá mais se cadastrar.`
        }
        confirmLabel={
          confirmAction?.type === "deactivate"
            ? "Desativar"
            : confirmAction?.type === "reactivate"
              ? "Reativar"
              : "Revogar"
        }
        tone={confirmAction?.type === "reactivate" ? "default" : "destructive"}
        pending={isPending}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.type === "deactivate") handleDeactivate(confirmAction.userId);
          else if (confirmAction.type === "reactivate") handleReactivate(confirmAction.userId);
          else if (confirmAction.type === "revoke") handleRevoke(confirmAction.userId);
        }}
      />

      {/* CNH Edit Dialog */}
      <Dialog open={cnhEdit !== null} onOpenChange={(open) => { if (!open) setCnhEdit(null); }}>
        <DialogHeader>
          <DialogTitle>Editar data da CNH</DialogTitle>
          <DialogDescription>
            Atualize a data de vencimento da CNH de {cnhEdit?.userName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="cnh-date">Data de vencimento</Label>
            <Input
              id="cnh-date"
              type="date"
              value={cnhEdit?.value ?? ""}
              onChange={(e) =>
                setCnhEdit((prev) => (prev ? { ...prev, value: e.target.value } : prev))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCnhEdit(null)}>
            Cancelar
          </Button>
          <Button onClick={handleCnhSave} disabled={isPending || !cnhEdit?.value}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* City Preferences Edit Dialog */}
      <Dialog open={cityEdit !== null} onOpenChange={(open) => { if (!open) setCityEdit(null); }}>
        <DialogHeader>
          <DialogTitle>Editar cidades de preferência</DialogTitle>
          <DialogDescription>
            Escolha de 1 a 3 cidades para {cityEdit?.userName}. São preferências,
            não garantia — o motorista pode ser alocado em outra cidade.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          {ALLOWED_CITIES.map((city) => {
            const isChecked = cityEdit?.selected.includes(city) ?? false;
            const isDisabled = !isChecked && (cityEdit?.selected.length ?? 0) >= MAX_CITIES;
            return (
              <label
                key={city}
                className={`flex cursor-pointer items-center gap-2 text-sm ${
                  isDisabled ? "cursor-not-allowed opacity-50" : ""
                }`}
              >
                <Checkbox
                  checked={isChecked}
                  disabled={isDisabled}
                  onCheckedChange={() => toggleCityEdit(city)}
                />
                {city}
              </label>
            );
          })}
          <p className="text-xs text-muted-foreground">
            {cityEdit?.selected.length ?? 0} de {MAX_CITIES} cidades selecionadas.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCityEdit(null)}>
            Cancelar
          </Button>
          <Button
            onClick={handleCitySave}
            disabled={isPending || (cityEdit?.selected.length ?? 0) < 1}
          >
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Vehicle Type Edit Dialog */}
      <Dialog open={vehicleEdit !== null} onOpenChange={(open) => { if (!open) setVehicleEdit(null); }}>
        <DialogHeader>
          <DialogTitle>Editar categoria de veículo</DialogTitle>
          <DialogDescription>
            Atualize a categoria de veículo de {vehicleEdit?.userName}. A
            alocação respeita a categoria com igualdade estrita.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="vehicle-type">Categoria</Label>
            <Select
              value={vehicleEdit?.value ?? ""}
              onValueChange={(v) =>
                setVehicleEdit((prev) =>
                  prev ? { ...prev, value: v as string } : prev
                )
              }
            >
              <SelectTrigger id="vehicle-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setVehicleEdit(null)}>
            Cancelar
          </Button>
          <Button onClick={handleVehicleSave} disabled={isPending || !vehicleEdit?.value}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
