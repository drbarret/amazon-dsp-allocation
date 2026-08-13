import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldOffIcon } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldOffIcon className="size-6 text-destructive" />
          </div>
          <CardTitle className="text-xl">Acesso negado</CardTitle>
          <CardDescription>
            Você não tem permissão para acessar esta página. Entre em contato
            com o administrador do sistema se acredita que isso é um erro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/dashboard"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Voltar ao início
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
