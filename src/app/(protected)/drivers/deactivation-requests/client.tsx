"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { toast } from "sonner";
import { reviewDeactivationRequest } from "../actions";

interface PendingRequest {
  id: string;
  reason: string | null;
  createdAt: Date;
  driver: { id: string; name: string; email: string };
  requestedBy: { id: string; name: string };
}

interface ResolvedRequest {
  id: string;
  status: string;
  reason: string | null;
  reviewNotes: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  driver: { id: string; name: string; email: string };
  requestedBy: { id: string; name: string };
  reviewer: { id: string; name: string } | null;
}

interface Props {
  pending: PendingRequest[];
  resolved: ResolvedRequest[];
}

export function DeactivationRequestsClient({ pending, resolved }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  function handleReview(requestId: string, decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      try {
        const result = await reviewDeactivationRequest(
          requestId,
          decision,
          reviewNotes || undefined,
        );
        if (result.success) {
          toast.success(
            decision === "APPROVED"
              ? "Desativação aprovada. Motorista desativado."
              : "Solicitação rejeitada.",
          );
          setReviewingId(null);
          setReviewNotes("");
          router.refresh();
        } else {
          toast.error(result.error ?? "Erro ao revisar.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao revisar.");
      }
    });
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Solicitações de Desativação"
        description="Aprove ou rejeite solicitações de desativação pendentes criadas por supervisores."
      />

      {/* Tabs */}
      <div className="flex gap-2">
        <Button
          variant={tab === "pending" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("pending")}
        >
          Pendentes ({pending.length})
        </Button>
        <Button
          variant={tab === "resolved" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("resolved")}
        >
          Histórico
        </Button>
      </div>

      {tab === "pending" && (
        <div className="space-y-3">
          {pending.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma solicitação pendente.</p>
          )}
          {pending.map((req) => (
            <div key={req.id} className="rounded border p-4 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{req.driver.name}</p>
                  <p className="text-xs text-muted-foreground">{req.driver.email}</p>
                </div>
                <StatusPill tone="warning">Pendente</StatusPill>
              </div>
              {req.reason && (
                <p className="text-sm">
                  <span className="font-medium">Motivo:</span> {req.reason}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Solicitado por {req.requestedBy.name} em{" "}
                {new Date(req.createdAt).toLocaleDateString("pt-BR")}
              </p>

              {reviewingId === req.id ? (
                <div className="space-y-2 pt-2">
                  <Input
                    placeholder="Notas da revisão (opcional)"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleReview(req.id, "APPROVED")}
                      disabled={isPending}
                    >
                      Aprovar e Desativar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleReview(req.id, "REJECTED")}
                      disabled={isPending}
                    >
                      Rejeitar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReviewingId(null);
                        setReviewNotes("");
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReviewingId(req.id)}
                >
                  Revisar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "resolved" && (
        <div className="space-y-3">
          {resolved.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum histórico.</p>
          )}
          {resolved.map((req) => (
            <div key={req.id} className="rounded border p-4 space-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{req.driver.name}</p>
                  <p className="text-xs text-muted-foreground">{req.driver.email}</p>
                </div>
                <StatusPill tone={req.status === "APPROVED" ? "danger" : "neutral"}>
                  {req.status === "APPROVED" ? "Aprovado" : "Rejeitado"}
                </StatusPill>
              </div>
              {req.reason && (
                <p className="text-sm">
                  <span className="font-medium">Motivo:</span> {req.reason}
                </p>
              )}
              {req.reviewNotes && (
                <p className="text-sm">
                  <span className="font-medium">Notas:</span> {req.reviewNotes}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Solicitado por {req.requestedBy.name} · Revisado por{" "}
                {req.reviewer?.name ?? "—"} em{" "}
                {req.reviewedAt
                  ? new Date(req.reviewedAt).toLocaleDateString("pt-BR")
                  : "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
