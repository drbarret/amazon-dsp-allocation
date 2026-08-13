import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 p-6 text-center">
      <div className="rounded-xl border bg-white p-8 shadow-sm max-w-md w-full">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-zinc-900">
          Acesso negado
        </h1>
        <p className="mb-6 text-sm text-zinc-500">
          Você não tem permissão para acessar esta página. Entre em contato com
          o administrador do sistema se acredita que isso é um erro.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
