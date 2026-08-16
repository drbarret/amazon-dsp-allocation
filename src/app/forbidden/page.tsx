import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { AuthBrand } from "@/components/auth-brand";
import { ShieldOffIcon } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <AuthBrand />
        <div className="flex size-12 items-center justify-center rounded-full bg-danger-bg">
          <ShieldOffIcon className="size-6 text-danger-fg" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-heading">Acesso negado</h1>
          <p className="text-sm leading-5 text-muted-foreground">
            Você não tem permissão para acessar esta página. Entre em contato
            com o administrador do sistema se acredita que isso é um erro.
          </p>
        </div>
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "outline", className: "w-full" })}
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
