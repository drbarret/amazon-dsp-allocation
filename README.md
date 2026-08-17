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

## Cobrança de CNH atualizada (e-mail)

A cobrança de CNH é uma **ação manual do supervisor**. Não existe disparo
automático, agendamento ou janela de vencimento: o supervisor identifica os
motoristas com CNH vencida, marca quem vai receber e clica em **"Cobrar CNH
atualizada"**. O e-mail é enviado apenas para os selecionados, usando
[Resend](https://resend.com).

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `RESEND_API_KEY` | Não* | Chave da API do Resend. Sem ela o sistema **degrada com log claro** e não envia e-mails (nenhuma quebra). |
| `EMAIL_FROM` | Não | Remetente autorizado no domínio do Resend. Padrão: `TRC Brasil <trc-brasil@instalog.com.br>`. |
| `EMAIL_TO_OVERRIDE` | Não | Redireciona todos os e-mails para um endereço de teste. |

\* Sem `RESEND_API_KEY` o e-mail não é enviado, mas o sistema continua funcionando.

> **Domínio do remetente:** o domínio `instalog.com.br` precisa estar **verificado
> na conta do Resend** para que os e-mails sejam entregues. O remetente padrão é
> `trc-brasil@instalog.com.br` (TRC = Transportation Risk and Compliance).

### Como a cobrança acontece

- O supervisor acessa a tela de cobrança de CNH (área de administração).
- A lista mostra os motoristas **ativos** com **CNH vencida**, a data de
  vencimento e **quando foi a última cobrança** de cada um.
- O supervisor marca os motoristas que devem receber e clica em
  **"Cobrar CNH atualizada"**.
- O servidor **revalida** cada selecionado (papel, ativo e CNH vencida) antes
  de enviar — a seleção vinda do cliente nunca é confiada.
- **Reenvio é permitido**: cada cobrança é registrada como histórico com
  data/hora e autor. O supervisor pode cobrar de novo quem ignorou.
- Após o envio, a tela mostra um resumo: quantos enviados, quantos falharam e
  por quê.

Nunca envie e-mails reais para motoristas em desenvolvimento — use
`EMAIL_TO_OVERRIDE` ou mocks nos testes.

## Login administrativo por magic link (Resend)

Além do **Login with Amazon** para motoristas e supervisores, administradores,
gerentes de contas e supervisores com e-mail `@instalog.com.br` podem acessar o
sistema por **magic link enviado por e-mail**. O fluxo usa o provider
[Resend](https://resend.com) do Auth.js.

### Por que existe

- Equipe interna da ILLT/Instalog não tem conta Amazon corporativa vinculada ao
  sistema de escala.
- O magic link mantém a **lista fechada de e-mails autorizados** (`allowed_emails`)
  como única fonte de verdade para acesso administrativo.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `AUTH_RESEND_KEY` | Sim* | Chave da API do Resend usada **exclusivamente** para envio dos links mágicos de login. |
| `AUTH_RESEND_FROM` | Sim* | Remetente autorizado no domínio do Resend. Padrão: `TRC Brasil <trc-brasil@instalog.com.br>`. |

\* Obrigatória apenas para habilitar o login por magic link. O Login with Amazon
continua funcionando independentemente.

> **Separação de responsabilidades:** `AUTH_RESEND_KEY`/`AUTH_RESEND_FROM` são
> dedicadas à autenticação. As variáveis `RESEND_API_KEY`/`EMAIL_FROM` continuam
> sendo usadas apenas para e-mails de negócio (cobrança de CNH). Recomendamos
> manter chaves separadas para facilitar rotação e auditoria.

> **Domínio do remetente:** o domínio `instalog.com.br` precisa estar
> **verificado na conta do Resend** para que os e-mails de login sejam entregues.

### Como liberar um administrador

1. Cadastre o e-mail corporativo na tabela `allowed_emails` (ou via admin do
   sistema) com o papel correto (`SUPERVISOR`, `ACCOUNT_MANAGER` ou `ADMIN`) e
   status `ACTIVE`.
2. O usuário acessa `/login`, seleciona a aba **E-mail**, digita o e-mail
   corporativo e clica em **Receber link de acesso**.
3. O Auth.js envia um e-mail com link único e de curta duração. Após clicar no
   link, o usuário é autenticado e a role é promovida automaticamente de
   `DRIVER` (padrão do novo usuário) para a role definida em `allowed_emails`.

### Segurança

- Apenas e-mails presentes em `allowed_emails` com status `ACTIVE` conseguem
  logar. Qualquer outro endereço é redirecionado para `/auth-error?error=unauthorized`.
- E-mails `REVOKED` não conseguem logar nem por Amazon nem por magic link.
- O magic link é de **uso único** e expira conforme configuração padrão do
  Auth.js (não armazenamos tokens manualmente).
- Nunca compartilhe `AUTH_RESEND_KEY` nem a configure em arquivos versionados.

## Licença

Privado — Uso interno ILLT / Instalog.
