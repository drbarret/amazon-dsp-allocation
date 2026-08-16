import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuthBrand } from "@/components/auth-brand";
import { CircleAlertIcon, ShieldOffIcon } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-6">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-card p-8 shadow-sm">
        <AuthBrand />

        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold text-heading">Entrar</h1>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Sistema de escala e alocação de motoristas. Acesso com sua conta
            Amazon corporativa.
          </p>
        </div>

        {error === "deactivated" && (
          <Alert variant="destructive">
            <ShieldOffIcon className="size-4" />
            <AlertTitle>Conta desativada</AlertTitle>
            <AlertDescription>
              Sua conta foi desativada. Entre em contato com o administrador.
            </AlertDescription>
          </Alert>
        )}

        {error === "unauthorized" && (
          <Alert variant="destructive">
            <CircleAlertIcon className="size-4" />
            <AlertTitle>E-mail não autorizado</AlertTitle>
            <AlertDescription>
              Seu e-mail não está autorizado a acessar o sistema. Entre em
              contato com seu gerente.
            </AlertDescription>
          </Alert>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("amazon", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" className="w-full" size="lg">
            Entrar com Amazon
          </Button>
        </form>

        <p className="text-center text-xs leading-4 text-muted-foreground">
          Acesso restrito a supervisores e motoristas cadastrados.
          <br />
          Problemas de acesso? Fale com o administrador.
        </p>
      </div>
    </div>
  );
}
