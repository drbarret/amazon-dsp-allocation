import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex items-center justify-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-slate-500">
              ILLT
            </span>
            <span className="text-sm font-semibold tracking-tight text-amber-600">
              Amazon DSP
            </span>
          </div>
          <CardTitle className="text-xl">Acesso ao Sistema de Escala</CardTitle>
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
              Entrar com Amazon
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-xs text-muted-foreground">
            Use seu e-mail corporativo autorizado.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
