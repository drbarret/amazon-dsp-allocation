"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  ShieldOffIcon,
  ShieldCheckIcon,
  Trash2Icon,
  SearchIcon,
  MailIcon,
  ClockIcon,
  CheckCircle2Icon,
  XCircleIcon,
  PencilIcon,
} from "lucide-react";
import {
  changeUserRole,
  deactivateUser,
  reactivateUser,
  inviteUser,
  revokeInvite,
  updateDriverCnh,
  updateDriverCityPreferences,
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

const ROLE_BADGE_VARIANT: Record<string, "default" | "success" | "warning" | "muted"> = {
  ADMIN: "default",
  ACCOUNT_MANAGER: "success",
  SUPERVISOR: "warning",
  DRIVER: "muted",
};

interface Props {
  users: UserRow[];
  currentUserId: string;
  roleLabels: Record<string, string>;
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

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Usuários e Perfis
          </h1>
          <p className="text-sm text-zinc-500">
            Gerencie usuários, papéis e convites de acesso ao sistema.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} disabled={isPending}>
          <UserPlusIcon className="mr-2 size-4" />
          Convidar Usuário
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <Input
          placeholder="Buscar por nome, e-mail ou papel..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* User table */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">CNH</th>
              <th className="px-4 py-3">Cidades</th>
              <th className="px-4 py-3">Último Acesso</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((user) => (
              <tr
                key={user.id}
                className={
                  user.source === "invite"
                    ? "bg-amber-50/50"
                    : user.active
                      ? "hover:bg-zinc-50"
                      : "bg-zinc-50 text-zinc-400"
                }
              >
                {/* Name */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-900">
                      {user.name}
                    </span>
                    {user.id === currentUserId && (
                      <Badge variant="muted" className="text-[10px]">você</Badge>
                    )}
                    {user.source === "invite" && (
                      <Badge variant="warning" className="text-[10px]">convite</Badge>
                    )}
                  </div>
                </td>

                {/* Email */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <MailIcon className="size-3.5 text-zinc-400" />
                    <span className="text-zinc-600">{user.email}</span>
                  </div>
                </td>

                {/* Role */}
                <td className="px-4 py-3">
                  {user.source === "user" ? (
                    <Select
                      value={user.role}
                      onValueChange={(v) => handleRoleChange(user.id, v as UserRole)}
                      disabled={isPending}
                    >
                      <SelectTrigger size="sm" className="w-36">
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
                    <Badge variant={ROLE_BADGE_VARIANT[user.role] ?? "muted"}>
                      {roleLabels[user.role] ?? user.role}
                    </Badge>
                  )}
                </td>

                {/* Active status */}
                <td className="px-4 py-3">
                  {user.active ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2Icon className="size-3" />
                      Ativo
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircleIcon className="size-3" />
                      {user.source === "invite" && user.allowedEmailStatus === "REVOKED"
                        ? "Revogado"
                        : "Inativo"}
                    </Badge>
                  )}
                </td>

                {/* Onboarding */}
                <td className="px-4 py-3">
                  {user.source === "invite" ? (
                    <span className="text-xs text-zinc-400">—</span>
                  ) : user.onboardingCompleted ? (
                    <Badge variant="success" className="text-[10px]">Completo</Badge>
                  ) : (
                    <Badge variant="muted" className="text-[10px]">Pendente</Badge>
                  )}
                </td>

                {/* CNH */}
                <td className="px-4 py-3">
                  {user.source === "user" && user.role === "DRIVER" ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-zinc-600">
                        {user.cnhExpiration
                          ? new Date(user.cnhExpiration).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })
                          : "—"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5"
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
                        title="Editar data da CNH"
                      >
                        <PencilIcon className="size-3.5 text-zinc-500" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  )}
                </td>

                {/* Cidades */}
                <td className="px-4 py-3">
                  {user.source === "user" && user.role === "DRIVER" ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-zinc-600">
                        {user.cityPreferences && user.cityPreferences.length > 0
                          ? user.cityPreferences.join(", ")
                          : "—"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5"
                        onClick={() =>
                          setCityEdit({
                            userId: user.id,
                            userName: user.name,
                            selected: user.cityPreferences ?? [],
                          })
                        }
                        disabled={isPending}
                        title="Editar cidades de preferência"
                      >
                        <PencilIcon className="size-3.5 text-zinc-500" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  )}
                </td>

                {/* Last login */}
                <td className="px-4 py-3">
                  {user.lastLoginAt ? (
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <ClockIcon className="size-3" />
                      {new Date(user.lastLoginAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-400">Nunca acessou</span>
                  )}
                </td>

                {/* Actions */}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {user.source === "user" ? (
                      user.active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConfirmAction({
                              type: "deactivate",
                              userId: user.id,
                              userName: user.name,
                            })
                          }
                          disabled={isPending || user.id === currentUserId}
                          title="Desativar usuário"
                        >
                          <ShieldOffIcon className="size-4 text-destructive" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConfirmAction({
                              type: "reactivate",
                              userId: user.id,
                              userName: user.name,
                            })
                          }
                          disabled={isPending}
                          title="Reativar usuário"
                        >
                          <ShieldCheckIcon className="size-4 text-emerald-600" />
                        </Button>
                      )
                    ) : user.allowedEmailStatus === "ACTIVE" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setConfirmAction({
                            type: "revoke",
                            userId: user.allowedEmailId!,
                            userName: user.email,
                          })
                        }
                        disabled={isPending}
                        title="Revogar convite"
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-zinc-400">
                  Nenhum usuário encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400">
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
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {confirmAction?.type === "deactivate"
              ? "Desativar Usuário"
              : confirmAction?.type === "reactivate"
                ? "Reativar Usuário"
                : "Revogar Convite"}
          </DialogTitle>
          <DialogDescription>
            {confirmAction?.type === "deactivate"
              ? `Tem certeza que deseja desativar ${confirmAction?.userName}? O usuário não poderá fazer login até ser reativado.`
              : confirmAction?.type === "reactivate"
                ? `Tem certeza que deseja reativar ${confirmAction?.userName}?`
                : `Tem certeza que deseja revogar o convite de ${confirmAction?.userName}?`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmAction(null)}>
            Cancelar
          </Button>
          <Button
            variant={confirmAction?.type === "reactivate" ? "default" : "destructive"}
            onClick={() => {
              if (!confirmAction) return;
              if (confirmAction.type === "deactivate") handleDeactivate(confirmAction.userId);
              else if (confirmAction.type === "reactivate") handleReactivate(confirmAction.userId);
              else if (confirmAction.type === "revoke") handleRevoke(confirmAction.userId);
            }}
            disabled={isPending}
          >
            {confirmAction?.type === "deactivate"
              ? "Desativar"
              : confirmAction?.type === "reactivate"
                ? "Reativar"
                : "Revogar"}
          </Button>
        </DialogFooter>
      </Dialog>

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
    </div>
  );
}
