import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 p-6 text-center">
      <div className="rounded-xl border bg-white p-8 shadow-sm max-w-sm w-full">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-zinc-900">
          Amazon DSP
        </h1>
        <p className="mb-6 text-sm text-zinc-500">
          Sistema de Alocação de Motoristas
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("amazon", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" className="w-full">
            Entrar com a Amazon
          </Button>
        </form>
      </div>
    </div>
  );
}
