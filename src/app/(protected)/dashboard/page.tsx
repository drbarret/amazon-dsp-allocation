import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 p-6 text-center">
      <div className="rounded-xl border bg-white p-8 shadow-sm max-w-sm w-full">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-zinc-900">
          Dashboard
        </h1>
        <p className="mb-1 text-lg text-zinc-700">
          Olá, {session.user.name ?? "Usuário"}!
        </p>
        <p className="mb-6 text-sm text-zinc-500">{session.user.email}</p>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button type="submit" variant="outline" className="w-full">
            Sair
          </Button>
        </form>
      </div>
    </div>
  );
}
