import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 p-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-zinc-900">
        Amazon DSP Driver Allocation
      </h1>
      <p className="max-w-md text-lg text-zinc-600">
        Sistema de alocação de motoristas. O esqueleto do projeto está
        configurado com Next.js, TypeScript, Tailwind e shadcn/ui.
      </p>
      <Button>Bem-vindo</Button>
    </div>
  );
}
