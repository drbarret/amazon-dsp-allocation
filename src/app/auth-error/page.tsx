import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 p-6 text-center">
      <div className="rounded-xl border bg-white p-8 shadow-sm max-w-md w-full">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-zinc-900">
          Acesso não autorizado
        </h1>
        <p className="mb-6 text-sm text-zinc-500">
          Seu e-mail não está autorizado a acessar o sistema. Entre em contato
          com seu gerente ou administrador para solicitar acesso.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Voltar ao login
        </Link>
      </div>
    </div>
  );
}
