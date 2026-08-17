"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuthBrand } from "@/components/auth-brand";
import {
  CircleAlertIcon,
  ShieldOffIcon,
  MailIcon,
  Loader2Icon,
  CheckCircle2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type LoginTab = "amazon" | "resend";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [tab, setTab] = React.useState<LoginTab>("amazon");
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState("");
  const [submitError, setSubmitError] = React.useState("");

  const handleAmazonSignIn = async () => {
    setIsLoading(true);
    await signIn("amazon", { redirectTo: "/dashboard" });
  };

  const handleResendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage("");
    setSubmitError("");

    if (!isValidEmail(email)) {
      setEmailError("Digite um e-mail válido.");
      return;
    }

    setEmailError("");
    setIsLoading(true);

    try {
      const result = await signIn("resend", {
        email,
        redirect: false,
      });

      if (result?.ok) {
        setSuccessMessage(
          `Verifique sua caixa de entrada. O link foi enviado para ${email}.`
        );
        setEmail("");
      } else {
        setSubmitError(
          "Não foi possível enviar o link. Verifique o e-mail e tente novamente."
        );
      }
    } catch {
      setSubmitError(
        "Não foi possível enviar o link. Verifique o e-mail e tente novamente."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-6">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-card p-8 shadow-sm">
        <AuthBrand />

        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold text-heading">Entrar</h1>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Sistema de escala e alocação de motoristas.
          </p>
        </div>

        {initialError === "deactivated" && (
          <Alert variant="destructive">
            <ShieldOffIcon className="size-4" />
            <AlertTitle>Conta desativada</AlertTitle>
            <AlertDescription>
              Sua conta foi desativada. Entre em contato com o administrador.
            </AlertDescription>
          </Alert>
        )}

        {initialError === "unauthorized" && (
          <Alert variant="destructive">
            <CircleAlertIcon className="size-4" />
            <AlertTitle>E-mail não autorizado</AlertTitle>
            <AlertDescription>
              Seu e-mail não está autorizado a acessar o sistema. Entre em
              contato com seu gerente.
            </AlertDescription>
          </Alert>
        )}

        {successMessage && (
          <Alert variant="default" className="border-green-600/20 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100">
            <CheckCircle2Icon className="size-4 text-green-600 dark:text-green-400" />
            <AlertTitle>Link enviado</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {submitError && (
          <Alert variant="destructive">
            <CircleAlertIcon className="size-4" />
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
          <button
            type="button"
            onClick={() => setTab("amazon")}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === "amazon"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            aria-pressed={tab === "amazon"}
          >
            Amazon
          </button>
          <button
            type="button"
            onClick={() => setTab("resend")}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === "resend"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            aria-pressed={tab === "resend"}
          >
            E-mail
          </button>
        </div>

        {tab === "amazon" ? (
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm text-muted-foreground">
              Acesse com sua conta Amazon corporativa vinculada ao e-mail
              cadastrado.
            </p>
            <Button
              type="button"
              onClick={handleAmazonSignIn}
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : null}
              Entrar com Amazon
            </Button>
          </div>
        ) : (
          <form onSubmit={handleResendSubmit} className="flex flex-col gap-4">
            <p className="text-center text-sm text-muted-foreground">
              Receba um link mágico de acesso no seu e-mail.
            </p>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <div className="relative">
                <MailIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError("");
                  }}
                  disabled={isLoading}
                  aria-invalid={!!emailError}
                  className="pl-9"
                />
              </div>
              {emailError && (
                <p className="text-sm text-destructive">{emailError}</p>
              )}
            </div>
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : null}
              Receber link de acesso
            </Button>
          </form>
        )}

        <p className="text-center text-xs leading-4 text-muted-foreground">
          Acesso restrito a supervisores e motoristas cadastrados.
          <br />
          Problemas de acesso? Fale com o administrador.
        </p>
      </div>
    </div>
  );
}
