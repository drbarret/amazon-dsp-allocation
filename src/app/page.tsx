import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { AuthBrand } from "@/components/auth-brand";

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <AuthBrand />
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-heading">
            Sistema de escala e alocação de motoristas
          </h1>
          <p className="text-sm text-muted-foreground">
            Escala semanal, dispatch de vagas, comportamento e cobrança de CNH
            da sua operação Amazon DSP.
          </p>
        </div>
        <Link
          href="/login"
          className={buttonVariants({ size: "lg", className: "w-full" })}
        >
          Entrar
        </Link>
      </div>
    </div>
  );
}
