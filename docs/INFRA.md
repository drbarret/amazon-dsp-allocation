# Infraestrutura — Amazon DSP Driver Allocation System

Este documento lista os recursos de infraestrutura do projeto. **Nenhuma senha ou token deve ser salvo aqui**; os valores reais ficam apenas no Vercel e no arquivo `.env` local (`.gitignored`).

## Status do provisionamento

| Recurso | Método | Status |
|---------|--------|--------|
| PostgreSQL (Supabase) | Manual no dashboard | **Ativo e testado** |
| Redis (Upstash) | Automatizado via CLI | **Ativo e testado** |
| Vercel (projeto + env vars) | Automatizado via CLI | **Projeto criado e vinculado** |
| Vercel <-> GitHub Git Integration | Manual no dashboard | **Conectado e verificado (auto-deploy funcional)** |
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

> **URL canônica (verificado em 2026-08-15):** a URL canônica do projeto é
> `https://amazon-dsp-allocation-illt.vercel.app` (slug completo). O domínio curto
> `https://amazon-dsp-allocation.vercel.app` também aponta para este mesmo projeto hoje —
> ambos retornam HTTP 200 e servem conteúdo byte-idêntico (mesmo hash SHA-256 da resposta
> de `/`). Não é mais uma colisão de domínio de outro projeto. Use sempre o slug completo
> como referência canônica; o domínio curto é não-autoritativo.

## Variáveis de ambiente no Vercel

Variáveis já configuradas:

- `DATABASE_URL` — Production, Preview, Development
- `REDIS_URL` — Production, Preview, Development
- `NEXTAUTH_SECRET` — Development
- `NEXTAUTH_URL` — Development
- `AUTH_AMAZON_ID` — Production, Preview, Development
- `AUTH_AMAZON_SECRET` — Production, Preview, Development
- `AUTH_SECRET` — Production, Preview, Development
- `AUTH_URL` — Production, Preview, Development
- `FIELD_ENCRYPTION_KEY` — Production, Preview, Development
- `FIELD_BLIND_INDEX_KEY` — Production, Preview, Development

Variáveis pendentes:

- `WHATSAPP_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`

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

## Autenticação: Login with Amazon (LWA)

**Decisão (2026-08-11):** Substituímos AWS Cognito por Login with Amazon (LWA) direto via OAuth 2.0. A implementação usa Auth.js (NextAuth v5) com um provider OAuth customizado.

**Endpoints LWA:**
- Authorization: `https://www.amazon.com/ap/oa`
- Token: `https://api.amazon.com/auth/o2/token`
- User Profile: `https://api.amazon.com/user/profile`
- Scope: `profile` (retorna `user_id`, `name`, `email`)

**Callback URL verificada em produção (2026-08-12):**
- `https://amazon-dsp-allocation-illt.vercel.app/api/auth/callback/amazon`
- Extraída do `redirect_uri` no redirect do signin para `amazon.com` (verificado com `curl -X POST /api/auth/signin/amazon`)

**Callback URLs que devem ser registradas no Amazon Developer Console:**
- Produção: `https://amazon-dsp-allocation-illt.vercel.app/api/auth/callback/amazon`
- Desenvolvimento local: `http://localhost:3000/api/auth/callback/amazon`

**Allowed Origins:**
- `https://amazon-dsp-allocation-illt.vercel.app`
- `http://localhost:3000`

**Variáveis de ambiente:**
- `AUTH_AMAZON_ID` — LWA Client ID
- `AUTH_AMAZON_SECRET` — LWA Client Secret
- `AUTH_SECRET` — Auth.js secret (32+ chars)
- `AUTH_URL` — URL base da aplicação

**Modelo de dados:** As tabelas `accounts`, `sessions` e `verification_tokens` foram adicionadas ao schema Prisma para suportar o adapter de banco de dados do Auth.js.

## Controle de acesso (lista fechada)

O sistema usa uma lista fechada de e-mails pré-registrados para controle de acesso:

1. **Pré-registro:** apenas e-mails cadastrados na tabela `allowed_emails` com status `ACTIVE` podem fazer login.
2. **Usuário desativado:** um usuário com `active = false` ou `AllowedEmail.status = 'REVOKED'` é recusado em qualquer ponto.
3. **Sem bypass por domínio:** não há aprovação automática por domínio corporativo. Todo acesso é individual e explícito.

### Como pré-registrar um e-mail

Insira uma linha na tabela `allowed_emails`:

```sql
INSERT INTO allowed_emails (id, email, role, "invitedById", status, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'novo@exemplo.com', 'DRIVER', '<admin_user_id>', 'ACTIVE', now(), now());
```

Para revogar o acesso:

```sql
UPDATE allowed_emails SET status = 'REVOKED', "updatedAt" = now() WHERE email = 'email@exemplo.com';
```

### Hierarquia de roles

`ADMIN` > `ACCOUNT_MANAGER` > `SUPERVISOR` > `DRIVER`

### Criptografia de campos sensíveis

CPF e telefone são criptografados com AES-256-GCM antes da persistência. O CPF possui um índice cego determinístico (HMAC-SHA256) para busca de duplicatas sem expor o valor real. As chaves são configuradas via `FIELD_ENCRYPTION_KEY` e `FIELD_BLIND_INDEX_KEY`.

### Correção de role congelada

O callback `jwt` do Auth.js agora re-lê a role do banco de dados a cada 60 segundos (janela de frescor), eliminando a necessidade de re-login após mudança de role. Usuários desativados têm `active = false` propagado para o token e são recusados em todas as verificações.

## Deployment Protection (Vercel)

**Status (2026-08-12):** Vercel Authentication (SSO Protection) foi **desabilitado** para produção via API REST (`PATCH /v9/projects` com `ssoProtection: null`).

**Motivo:** O Vercel Authentication estava interceptando todas as rotas dinâmicas (`/api/auth/*`, `/dashboard`), redirecionando para `vercel.com/sso-api`. Isso bloqueava completamente o fluxo OAuth do Login with Amazon, pois o callback `/api/auth/callback/amazon` era interceptado antes de chegar ao Next.js.

**Evidência da correção:**
- `GET /api/auth/providers` → retorna JSON com o provider `amazon` (antes retornava HTML do Vercel)
- `GET /dashboard` (não autenticado) → redireciona para `/login` (antes redirecionava para `vercel.com/sso-api`)
- `POST /api/auth/signin/amazon` → redireciona para `amazon.com/ap/oa` com o `redirect_uri` correto

**Configuração anterior:** `ssoProtection.deploymentType: "all_except_custom_domains"` (Vercel Authentication ativo para todos os deployments)

**Para reabilitar (se necessário):** Acesse https://vercel.com/illt/amazon-dsp-allocation/settings → Deployment Protection → Vercel Authentication → Enable

## Conexão Vercel <-> GitHub (Git Integration)

**Status:** Conectado e verificado. Em 2026-08-11, um push trivial para `main` disparou automaticamente o deployment `j989czh70` (Production, 38s, Ready). O `vercel git connect` via CLI confirmou "already connected".

**Framework Preset:** Corrigido de `Other` para `Next.js` via `npx vercel project update --framework nextjs --output-directory .next` em 2026-08-11.

**Configuração atual do projeto:**

| Setting | Value |
|---------|-------|
| Framework Preset | Next.js |
| Build Command | `npm run build` or `next build` |
| Output Directory | `.next` |
| Install Command | `npm install` |
| Root Directory | `.` |
| Node.js Version | 24.x |

**Verificação de auto-deploy (2026-08-11):**

1. Commit `7ac4515` pushed to `main` → deployment `j989czh70` criado automaticamente
2. Status: `Building` → `Ready` (38s)
3. URL do deployment: https://amazon-dsp-allocation-j989czh70-illt.vercel.app (HTTP 200)
4. URL de produção: https://amazon-dsp-allocation-illt.vercel.app (HTTP 200)

**Passos manuais (já concluídos):**

1. Acesse https://vercel.com/illt/amazon-dsp-allocation/settings/git
2. Conecte o repositório `drbarret/amazon-dsp-allocation`
3. Configure Production Branch como `main`
4. Framework Preset: Next.js (corrigido via CLI)
