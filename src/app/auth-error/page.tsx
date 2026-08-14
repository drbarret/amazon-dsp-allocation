import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldXIcon } from "lucide-react";

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldXIcon className="size-6 text-destructive" />
          </div>
          <CardTitle className="text-xl">Acesso não autorizado</CardTitle>
          <CardDescription>
            Seu acesso ainda não foi liberado. Entre em contato com seu
            supervisor ou gerente de contas para solicitar a liberação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/login"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Voltar ao login
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
