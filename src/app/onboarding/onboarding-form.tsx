"use client";

import { useState, useActionState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { submitOnboarding } from "./actions";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";

const RESTRICTION_LABELS: Record<string, string> = {
  GNV: "GNV (Gás Natural Veicular)",
  REFRIGERADOR: "Refrigerador / Baú Térmico",
  CAPACIDADE_REDUZIDA: "Capacidade Reduzida",
  NATURAL_GAS: "Gás Natural",
};

export function OnboardingForm() {
  const [vehicleType, setVehicleType] = useState("CARGO_VAN");
  const [restrictions, setRestrictions] = useState<Record<string, boolean>>({});
  const [consent, setConsent] = useState(false);

  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      const result = await submitOnboarding(formData);
      if (result?.error) {
        return result;
      }
      return null;
    },
    null,
  );

  const toggleRestriction = (code: string) => {
    setRestrictions((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">Complete seu cadastro</CardTitle>
          <CardDescription>
            Preencha os dados abaixo para começar a usar o sistema de alocação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-5">
            {state?.error && (
              <Alert variant="destructive">
                <AlertCircleIcon className="size-4" />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            {/* CPF */}
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF</Label>
              <Input
                id="cpf"
                name="cpf"
                placeholder="000.000.000-00"
                required
                maxLength={14}
                inputMode="numeric"
              />
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone (WhatsApp)</Label>
              <Input
                id="phone"
                name="phone"
                placeholder="(11) 99999-9999"
                required
                maxLength={16}
                inputMode="tel"
              />
            </div>

            {/* Vehicle Type */}
            <div className="space-y-2">
              <Label htmlFor="vehicleType">Tipo de veículo</Label>
              <Select
                name="vehicleType"
                value={vehicleType}
                onValueChange={(v) => v && setVehicleType(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CARGO_VAN">Cargo Van</SelectItem>
                  <SelectItem value="PASSEIO">Veículo de Passeio</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="vehicleType" value={vehicleType} />
            </div>

            {/* Vehicle Restrictions */}
            <div className="space-y-2">
              <Label>Restrições do veículo</Label>
              <div className="space-y-2 rounded-lg border p-3">
                {Object.entries(RESTRICTION_LABELS).map(([code, label]) => (
                  <label
                    key={code}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      name={`restriction_${code}`}
                      checked={restrictions[code] ?? false}
                      onCheckedChange={() => toggleRestriction(code)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* LGPD Consent */}
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  name="consent"
                  checked={consent}
                  onCheckedChange={(c) => setConsent(!!c)}
                  required
                />
                <span className="text-muted-foreground">
                  Autorizo o processamento dos meus dados pessoais (CPF e
                  telefone) para fins de alocação de rotas, conforme a Lei Geral
                  de Proteção de Dados (LGPD).
                </span>
              </label>
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Concluir cadastro
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
