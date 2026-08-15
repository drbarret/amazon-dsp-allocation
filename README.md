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

As especificações autoritativas do sistema estão em [`docs/plans/`](docs/plans/):

- [Plano de implementação](docs/plans/PLAN.md) — fases, tarefas, cronograma e critérios de sucesso
- [Requisitos](docs/plans/requirements.md) — RF, RNF, regras de negócio e papéis
- [Modelo de dados](docs/plans/data-model.md) — schema Prisma, entidades, índices e fluxos
- [UX e wireframes](docs/plans/ux-flows.md) — especificação tela a tela, componentes e classes Tailwind
- [Algoritmo de distribuição](docs/plans/distribution-algorithm.md) — pseudocódigo, scoring e edge cases
- [Decisões de arquitetura](docs/plans/adr.md) — ADR com stack, segurança e compliance

Documentação operacional:

- Infraestrutura e recursos provisionados: `docs/INFRA.md`

## Infraestrutura

Os recursos de desenvolvimento (PostgreSQL/Supabase, Redis/Upstash e Vercel) estão documentados em `docs/INFRA.md`, junto com os comandos para testar conectividade:

```bash
npm run test:db
npm run test:redis
```

## Aviso de CNH vencendo (e-mail)

O sistema envia um aviso por e-mail ao motorista **30 dias antes** do vencimento
da CNH, usando [Resend](https://resend.com). O envio é **idempotente**: cada
motorista recebe no máximo um aviso por data de vencimento (garantido por uma
constraint única no banco).

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `RESEND_API_KEY` | Não* | Chave da API do Resend. Sem ela o sistema **degrada com log claro** e não envia e-mails (nenhuma quebra). |
| `EMAIL_FROM` | Não | Remetente autorizado no domínio do Resend. |
| `EMAIL_TO_OVERRIDE` | Não | Redireciona todos os e-mails para um endereço de teste. |
| `CRON_SECRET` | Sim (para disparo) | Token que protege o endpoint de disparo. |

\* Sem `RESEND_API_KEY` o aviso não é enviado, mas o sistema continua funcionando.

### Como o disparo acontece

O disparo é feito por um **endpoint protegido** `POST /api/cron/cnh-reminders`,
que exige `Authorization: Bearer <CRON_SECRET>`. Um endpoint aberto que
disparasse e-mails em massa seria grave, por isso o token é obrigatório.

- **Na Vercel:** agende via `vercel.json` (`crons`) apontando para o endpoint.
- **Manual:** `node scripts/send-cnh-reminders.mjs` (ou `--dry-run` para simular).

Nunca envie e-mails reais para motoristas em desenvolvimento — use
`EMAIL_TO_OVERRIDE` ou `--dry-run`.

## Licença

Privado — Uso interno ILLT / Instalog.
