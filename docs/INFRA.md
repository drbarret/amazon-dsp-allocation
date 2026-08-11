# Infraestrutura — Amazon DSP Driver Allocation System

Este documento lista os recursos de infraestrutura do projeto. **Nenhuma senha ou token deve ser salvo aqui**; os valores reais ficam apenas no Vercel e no arquivo `.env` local (`.gitignored`).

## Status do provisionamento

| Recurso | Método | Status |
|---------|--------|--------|
| PostgreSQL (Supabase) | Manual no dashboard | **Ativo e testado** |
| Redis (Upstash) | Automatizado via CLI | **Ativo e testado** |
| Vercel (projeto + env vars) | Automatizado via CLI | **Projeto criado e vinculado** |
| Vercel <-> GitHub Git Integration | Manual no dashboard | **Pendente — ver instruções abaixo** |
| GitHub Actions CI | Automatizado via workflow | **Configurado** |

## Ambiente: Desenvolvimento

| Recurso | Provedor | Região | Nome / ID | URL do dashboard |
|---------|----------|--------|-----------|------------------|
| PostgreSQL | Supabase | `sa-east-1` | `amazon-dsp-allocation-dev` (ref: `urpjdqokedunpfmnxoac`) | https://supabase.com/dashboard/project/urpjdqokedunpfmnxoac |
| Redis | Upstash | `sa-east-1` | `amazon-dsp-allocation-dev` (ID: `78be2f4b-53e4-4d2e-894c-8a5478dc93b4`) | https://console.upstash.com/redis/78be2f4b-53e4-4d2e-894c-8a5478dc93b4 |
| Hospedagem | Vercel | *edge* | `amazon-dsp-allocation` (illt) | https://vercel.com/illt/amazon-dsp-allocation |

## Ambiente: Produção

| Recurso | URL |
|---------|-----|
| Produção (alias) | https://amazon-dsp-allocation-illt.vercel.app |
| Deploy direto | https://amazon-dsp-allocation-7j2cr5kan-illt.vercel.app |
| Inspect | https://vercel.com/illt/amazon-dsp-allocation/4xZfdfZfBvNYWwqcvsJUVs4hQ9wT |

## Variáveis de ambiente no Vercel

Variáveis já configuradas:

- `DATABASE_URL` — Production, Preview, Development
- `REDIS_URL` — Production, Preview, Development
- `NEXTAUTH_SECRET` — Development
- `NEXTAUTH_URL` — Development

Variáveis pendentes:

- `COGNITO_CLIENT_ID`
- `COGNITO_CLIENT_SECRET`
- `COGNITO_ISSUER`
- `WHATSAPP_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`
- `ENCRYPTION_KEY`

## Como obter os valores locais

Após configurar as variáveis no dashboard da Vercel:

```bash
npx vercel env pull
```

Isso cria/atualiza o arquivo `.env` na máquina local.

## Testes de conectividade

```bash
# PostgreSQL
node scripts/test-db.mjs

# Redis
node scripts/test-redis.mjs

# Prisma Client (requer schema gerado)
node scripts/test-prisma-client.mjs
```

## Prisma e migrations

- O schema fica em `prisma/schema.prisma`.
- O datasource é configurado em `prisma.config.ts`, que carrega `.env.local` e, quando necessário, adiciona `pgbouncer=true&connection_limit=1` para o pooler do Supabase.
- O Prisma Client é gerado em `src/generated/prisma` (gitignored).
- Prisma 7 exige um driver adapter; usamos `@prisma/adapter-pg`:

  ```ts
  import { PrismaPg } from "@prisma/adapter-pg";
  import { PrismaClient } from "@/generated/prisma";

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  export const prisma = new PrismaClient({ adapter });
  ```

- Comandos úteis:

  ```bash
  npx prisma validate
  npx prisma format
  npx prisma generate
  npm run db:generate   # alias para prisma generate
  npm run db:migrate    # alias para prisma migrate dev
  npm run db:deploy     # alias para prisma migrate deploy
  npx prisma studio
  ```

- **Atenção:** o schema engine do Prisma pode não conseguir se comunicar com o **transaction pooler** do Supabase (`*.pooler.supabase.com:6543`) para comandos como `migrate dev`, `migrate deploy` e `migrate status`. Nesse cenário, gere o SQL com `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` e aplique manualmente (ou use uma `DIRECT_URL` apontando para a porta 5432 do Supabase). O script utilitário `scripts/apply-migration.mjs` pode ser usado para aplicar uma migration e registrá-la na tabela `_prisma_migrations`.

## Decisões de infraestrutura

- **PostgreSQL:** Supabase (preferido no ADR) por ser gerenciado, ter pooler de conexões para serverless e camada gratuita.
- **Redis:** Upstash (preferido no ADR) por ser serverless, ter TLS nativo e preço inicial baixo.
- **Região:** Preferência por `sa-east-1` / São Paulo para conformidade com a LGPD.
- **Credenciais:** Nunca commitadas; gerenciadas via Vercel + `.env` local.

## CI/CD (GitHub Actions)

O workflow `.github/workflows/ci.yml` executa em push para `main` e em pull requests:

| Job | O que faz | Bloqueante? |
|-----|-----------|-------------|
| `lint-typecheck-build` | `npm ci` → `prisma generate` → `lint` → `typecheck` → `build` | Sim |
| `test` | `npm ci` → `prisma generate` → `vitest --run --passWithNoTests` | Não (`continue-on-error: true`) |

Variáveis dummy (`DATABASE_URL`, `REDIS_URL`) são definidas no `env` do workflow para que o build não precise de credenciais reais. O Prisma Client é gerado com `npx prisma generate` antes do build.

O `postinstall` no `package.json` executa `prisma generate`, garantindo que o Vercel gere o cliente automaticamente durante `npm install`.

## Conexão Vercel <-> GitHub (Git Integration)

**Status:** Conectado. Verificado em 2026-08-11 via `vercel git connect` (CLI reportou "already connected").

**Passos manuais:**

1. Acesse https://vercel.com/illt/amazon-dsp-allocation/settings/git
2. Clique em "Connect Git Repository"
3. Selecione `drbarret/amazon-dsp-allocation`
4. Configure:
   - **Production Branch:** `main`
   - **Framework Preset:** Next.js
   - **Build Command:** `npm run build` (override se necessário)
   - **Output Directory:** `.next`
   - **Install Command:** `npm install`
5. Salve. Após conectar, pushes para `main` disparam deploys de produção e PRs disparam preview deployments automaticamente.

Enquanto a integração Git não estiver ativa, deploys precisam ser disparados manualmente via `npx vercel --prod`.
