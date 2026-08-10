# Amazon DSP Driver Allocation System

Sistema de alocação de motoristas para operação Amazon DSP (ILLT). Consolida disponibilidade, publica vagas aprovadas, distribui motoristas automaticamente em escalas, permite ajustes do supervisor e envia a escala individual via WhatsApp Business.

## Stack

- **Framework:** [Next.js](https://nextjs.org/) 16 (App Router)
- **Linguagem:** TypeScript (strict)
- **Estilo:** Tailwind CSS 4
- **Componentes:** [shadcn/ui](https://ui.shadcn.com/)
- **ORM:** [Prisma](https://www.prisma.io/)
- **Banco:** PostgreSQL
- **Cache/Filas:** Redis
- **Testes:** Vitest + Playwright
- **Hospedagem:** Vercel

## Estrutura de Pastas

```
.
├── .github/workflows/   # CI/CD
├── prisma/              # Schema e migrações do Prisma
├── public/              # Ativos estáticos
├── src/
│   ├── app/             # Rotas do App Router
│   ├── components/      # Componentes React (inclui ui/ do shadcn)
│   ├── lib/             # Utilitários client-safe
│   └── server/          # Server Actions, services e data access
└── package.json
```

## Pré-requisitos

- Node.js 20+
- npm
- Git
- PostgreSQL (local ou remoto)
- Redis (local ou remoto)

## Configuração Local

1. Clone o repositório:

   ```bash
   git clone https://github.com/drbar/amazon-dsp-allocation.git
   cd amazon-dsp-allocation
   ```

2. Instale as dependências:

   ```bash
   npm install
   ```

3. Copie o arquivo de variáveis de ambiente:

   ```bash
   cp .env.example .env
   ```

4. Preencha `.env` com as credenciais locais (veja `.env.example`).

5. Gere o cliente Prisma e execute as migrações:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

6. Inicie o servidor de desenvolvimento:

   ```bash
   npm run dev
   ```

   Abra [http://localhost:3000](http://localhost:3000).

## Scripts Úteis

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia o servidor de desenvolvimento |
| `npm run build` | Gera a build de produção |
| `npm run start` | Inicia a aplicação em modo produção |
| `npm run lint` | Executa o ESLint |
| `npm run typecheck` | Verifica tipos com TypeScript |
| `npm run format` | Formata o código com Prettier |
| `npm run format:check` | Verifica formatação |
| `npm run test` | Executa os testes unitários |
| `npm run db:migrate` | Cria/executa migrações do Prisma |
| `npm run db:studio` | Abre o Prisma Studio |

## Estratégia de Branches

- `main` — branch de produção; deploys automáticos para staging via CI.
- Cada funcionalidade deve vir de uma branch `feature/<nome>` com Pull Request para `main`.

## Segurança

- **Nunca commite arquivos `.env` ou segredos.** Eles estão listados em `.gitignore`.
- Credenciais de produção devem ser configuradas apenas no Vercel / GitHub Secrets.

## Documentação do Projeto

- Plano de implementação: `plans/PLAN.md`
- Decisões de arquitetura: `plans/adr.md`

## Licença

Privado — Uso interno ILLT / Instalog.
