import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Amazon DSP</CardTitle>
          <CardDescription>Sistema de Alocação de Motoristas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error === "deactivated" && (
            <Alert variant="destructive">
              <AlertCircleIcon className="size-4" />
              <AlertDescription>
                Sua conta foi desativada. Entre em contato com o administrador.
              </AlertDescription>
            </Alert>
          )}

          {error === "unauthorized" && (
            <Alert variant="destructive">
              <AlertCircleIcon className="size-4" />
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
              Entrar com a Amazon
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
