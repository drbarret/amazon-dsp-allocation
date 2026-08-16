import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-page p-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-zinc-900">
        Amazon DSP Driver Allocation
      </h1>
      <p className="max-w-md text-lg text-zinc-600">
        Sistema de alocação de motoristas para entregadores Amazon DSP.
      </p>
      <Link
        href="/login"
        className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
      >
        Entrar
      </Link>
    </div>
  );
}
