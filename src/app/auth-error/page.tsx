import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { AuthBrand } from "@/components/auth-brand";
import { ShieldXIcon } from "lucide-react";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const isDeactivated = error === "deactivated";
  const isUnauthorized = error === "unauthorized";

  const title = isDeactivated
    ? "Conta desativada"
    : isUnauthorized
      ? "E-mail não autorizado"
      : "Acesso não autorizado";

  const message = isDeactivated
    ? "Sua conta foi desativada. Entre em contato com o administrador do sistema para solicitar a reativação."
    : isUnauthorized
      ? "Seu e-mail não está na lista de acesso autorizado. Entre em contato com seu supervisor ou gerente de contas para solicitar a liberação."
      : "Seu acesso ainda não foi liberado. Entre em contato com seu supervisor ou gerente de contas para solicitar a liberação.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <AuthBrand />
        <div className="flex size-12 items-center justify-center rounded-full bg-danger-bg">
          <ShieldXIcon className="size-6 text-danger-fg" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-heading">{title}</h1>
          <p className="text-sm leading-5 text-muted-foreground">{message}</p>
        </div>
        <Link
          href="/login"
          className={buttonVariants({ variant: "outline", className: "w-full" })}
        >
          Voltar ao login
        </Link>
      </div>
    </div>
  );
}
