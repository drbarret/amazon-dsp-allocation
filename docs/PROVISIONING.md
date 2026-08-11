# Guia de Provisionamento Manual — Amazon DSP Allocation

Este guia descreve como provisionar os recursos de desenvolvimento no navegador, caso o provisionamento automatizado via CLI não esteja disponível ou falhe por falta de credenciais/tokens válidos.

## Resultado do provisionamento (atual)

- ✅ **PostgreSQL (Supabase):** provisionado manualmente (`amazon-dsp-allocation-dev`, região `sa-east-1`, ref `urpjdqokedunpfmnxoac`); `DATABASE_URL` configurada e testada.
- ✅ **Redis (Upstash):** criado via CLI (`amazon-dsp-allocation-dev`, região `sa-east-1`).
- ✅ **Vercel:** projeto `illt/amazon-dsp-allocation` criado e vinculado; `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET` e `NEXTAUTH_URL` configuradas.

> Este guia permanece disponível como referência para novos ambientes ou re-provisionamento.

## Princípios

- **Nunca commite segredos.** Todos os valores reais ficam no Vercel e no arquivo `.env` local (`.gitignored`).
- Use **região de São Paulo** (`sa-east-1` ou equivalente) sempre que possível para conformidade com a LGPD.
- Inicie no **plano gratuito**; upgrade somente quando necessário.

---

## 1. PostgreSQL — Supabase (manual)

> O provisionamento automatizado do Supabase foi descontinuado nesta sessão porque o token de acesso fornecido não possui o formato esperado pelo CLI (`sbp_...`). Siga os passos abaixo no navegador.

### 1.1 Criar um novo projeto Supabase (ou usar um existente)

1. Acesse https://supabase.com/dashboard e faça login.
2. Clique em **New project**.
3. Escolha a organização desejada.
4. Preencha:
   - **Name:** `amazon-dsp-allocation-dev`
   - **Database Password:** gere uma senha forte e guarde-a em um cofre (não commite).
   - **Region:** `South America (São Paulo) sa-east-1`
   - **Plan:** Free
5. Clique em **Create new project**.
6. Anote o **Project reference ID** (ex.: `abcdefghijklmnopqrst`) para preencher `docs/INFRA.md`.

### 1.2 Obter a connection string correta (transaction pooler recomendado)

1. No dashboard do projeto, vá para **Project Settings > Database**.
2. Na seção **Connection string**, escolha **URI**.
3. Para aplicações serverless (Next.js/Vercel), use o **Transaction pooler**:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?schema=public
   ```
   Substituindo `[ref]` pelo Project reference ID e `[password]` pela senha do banco.
4. Como alternativa, a connection string direta (não pooler) tem o formato:
   ```
   postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?schema=public
   ```
5. Guarde essa string em um cofre; ela será usada no Vercel e no `.env` local.

### 1.3 Adicionar `DATABASE_URL` às variáveis de ambiente da Vercel

1. Acesse o projeto na Vercel: https://vercel.com/dashboard.
2. Vá para **Settings > Environment Variables**.
3. Adicione:
   - **Key:** `DATABASE_URL`
   - **Value:** a connection string do Supabase obtida no passo anterior
   - **Environments:** marque Production, Preview e Development
4. Clique em **Save**.
5. Repita para as demais variáveis obrigatórias listadas em `docs/INFRA.md` quando disponíveis.

### 1.4 Atualizar o placeholder `DATABASE_URL` no `.env.example`

O arquivo `C:\Users\drbar\Projects\amazon-dsp-allocation\.env.example` já contém o placeholder:

```bash
DATABASE_URL="postgresql://postgres:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?schema=public"
```

Ao copiar para `.env`, substitua `[password]` e `[region]` pelos valores reais. **Nunca commite o arquivo `.env`.**

---

## 2. Redis — Upstash

### 2.1 Criar o banco

1. Acesse https://console.upstash.com e faça login.
2. Vá para **Redis > Create database**.
3. Preencha:
   - **Name:** `amazon-dsp-allocation-dev`
   - **Region:** `sa-east-1` (São Paulo)
   - **Type:** Max / Free (se disponível) ou Regional pago, se o free não estiver disponível na região.
4. Clique em **Create**.

### 2.2 Obter a connection string

1. Na página do banco, vá para **Details**.
2. Copie o **Redis URL** (`rediss://default:[token]@[host]:[port]`).
3. Guarde essa URL no Vercel e no `.env` local.

### 2.3 Testar conectividade

Com a `REDIS_URL` definida no `.env`:

```bash
npm run test:redis
```

Ou diretamente com `redis-cli`:

```bash
redis-cli -u "$REDIS_URL" PING
```

---

## 3. Vercel — Projeto e variáveis de ambiente

### 3.1 Criar/linkar o projeto

1. Acesse https://vercel.com/dashboard e faça login.
2. Clique em **Add New > Project**.
3. Importe o repositório `drbarret/amazon-dsp-allocation`.
4. Preencha:
   - **Project Name:** `amazon-dsp-allocation`
   - **Framework Preset:** Next.js
5. Clique em **Deploy**.

### 3.2 Configurar variáveis de ambiente

1. No dashboard do projeto, vá para **Settings > Environment Variables**.
2. Adicione as variáveis abaixo (pelo menos as obrigatórias para iniciar):
   - `DATABASE_URL` — connection string do Supabase
   - `REDIS_URL` — URL do Upstash
   - `NEXTAUTH_SECRET` — string aleatória de pelo menos 32 caracteres
   - `NEXTAUTH_URL` — `http://localhost:3000` (dev)
3. Salve cada variável.

### 3.3 Sincronizar variáveis locais

No diretório do projeto, após configurar as variáveis no Vercel:

```bash
npx vercel login
npx vercel link
npx vercel env pull
```

Isso cria/atualiza o arquivo `.env` local.

---

## 4. Configuração local

1. Copie `.env.example` para `.env` (se ainda não tiver feito):
   ```bash
   copy .env.example .env
   ```
2. Preencha os valores reais no `.env`.
3. Execute os testes de conectividade:
   ```bash
   npm run test:db
   npm run test:redis
   ```

---

## 5. Documentar recursos

Após o provisionamento, atualize `docs/INFRA.md` com:

- Nome/ID do projeto Supabase
- Nome/ID do banco Upstash
- URL do projeto Vercel
- Região de cada recurso

**Não inclua senhas, tokens ou connection strings completas.**

---

## Solução de problemas

### Supabase: token de acesso inválido

Gere um novo token em **Account > Access Tokens** e use-o com:

```bash
npx supabase login
# ou
set SUPABASE_ACCESS_TOKEN=seu_token
```

### Upstash: CLI não disponível

Use o dashboard web ou a REST API com `curl`:

```bash
curl https://api.upstash.com/v2/redis/database \
  -u "drbarret@gmail.com:SUA_API_KEY"
```

### Vercel: login não completa

Certifique-se de autorizar o dispositivo em https://vercel.com/oauth/device?user_code=XXXX-XXXX dentro do tempo limite. Se falhar, use o login via navegador ou gere um token em **Account Settings > Tokens**.
