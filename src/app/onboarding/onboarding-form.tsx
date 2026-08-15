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
import { Progress } from "@/components/ui/progress";
import { submitOnboarding } from "./actions";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";

const RESTRICTION_LABELS: Record<string, string> = {
  GNV: "GNV (Gás Natural Veicular)",
  REFRIGERADOR: "Refrigerador / Baú Térmico",
  CAPACIDADE_REDUZIDA: "Capacidade Reduzida",
};

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

interface Props {
  userName: string;
  userEmail: string;
}

export function OnboardingForm({ userName, userEmail }: Props) {
  const [vehicleType, setVehicleType] = useState("CARGO_VAN");
  const [restrictions, setRestrictions] = useState<Record<string, boolean>>({});
  const [consent, setConsent] = useState(false);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);

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

  const toggleCity = (city: string) => {
    setSelectedCities((prev) => {
      if (prev.includes(city)) {
        return prev.filter((c) => c !== city);
      }
      if (prev.length >= MAX_CITIES) {
        return prev;
      }
      return [...prev, city];
    });
  };

  const canSubmit = consent && !isPending && selectedCities.length >= 1;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Progress value={0} className="mb-2" />
          <CardTitle className="text-xl">Complete seu cadastro</CardTitle>
          <CardDescription>
            Preencha os dados abaixo para começar a usar o sistema de alocação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            {state?.error && (
              <Alert variant="destructive">
                <AlertCircleIcon className="size-4" />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            {/* Full name — pre-filled from OAuth, read-only */}
            <div className="space-y-2">
              <Label htmlFor="name">Nome completo</Label>
              <Input
                id="name"
                value={userName}
                readOnly
                disabled
                className="bg-muted text-muted-foreground"
              />
            </div>

            {/* Email — pre-filled from OAuth, read-only */}
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                value={userEmail}
                readOnly
                disabled
                className="bg-muted text-muted-foreground"
              />
            </div>

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

            {/* Transporter ID */}
            <div className="space-y-2">
              <Label htmlFor="transporterId">Transporter ID (Amazon)</Label>
              <Input
                id="transporterId"
                name="transporterId"
                placeholder="Seu ID de transportador Amazon"
                inputMode="text"
              />
              <p className="text-xs text-muted-foreground">
                Identificador do motorista no sistema Amazon DSP.
              </p>
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
                  <SelectItem value="LARGE_VAN">Large Van</SelectItem>
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

            {/* City Preferences */}
            <div className="space-y-2">
              <Label>Cidades de preferência (escolha de 1 a 3)</Label>
              <div className="space-y-2 rounded-lg border p-3">
                {ALLOWED_CITIES.map((city) => {
                  const isChecked = selectedCities.includes(city);
                  const isDisabled = !isChecked && selectedCities.length >= MAX_CITIES;
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
                        onCheckedChange={() => toggleCity(city)}
                      />
                      {city}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedCities.length === 0
                  ? "Selecione pelo menos 1 cidade."
                  : `${selectedCities.length} de ${MAX_CITIES} cidades selecionadas.`}
              </p>
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Estas são apenas <strong>preferências</strong>, não uma garantia.
                Você pode ser alocado em outra cidade conforme a necessidade da
                operação. Após o cadastro, somente um supervisor pode alterar
                essas cidades.
              </p>
              <input
                type="hidden"
                name="cityPreferences"
                value={selectedCities.join(",")}
              />
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
                  Aceito o uso dos meus dados pessoais (CPF e telefone) para
                  fins de alocação de rotas, conforme a Lei Geral de Proteção
                  de Dados (LGPD).
                </span>
              </label>
            </div>

            <div className="sticky bottom-0 bg-card pt-4">
              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {isPending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                Concluir cadastro
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
