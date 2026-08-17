# Login administrativo por magic link

## Contexto e motivação

A equipe interna da ILLT/Instalog (`@instalog.com.br`) precisa acessar o sistema
de escala e alocação de motoristas, mas não possui contas Amazon corporativas
vinculadas ao Login with Amazon (LWA) usado por motoristas e supervisores de
rota.

A solução adotada foi adicionar ao Auth.js um segundo provider de autenticação:
**Resend**, que envia um magic link de uso único para o e-mail corporativo do
administrador. O acesso continua sendo controlado pela lista fechada de e-mails
autorizados (`allowed_emails`), garantindo que não seja criada uma “porta dos
fundos” no sistema.

## Provider adicionado

- **Nome:** `resend`
- **Pacote:** `@auth/core/providers/resend`
- **Local da configuração:** `src/lib/auth.ts`
- **Funcionamento:** o usuário informa o e-mail na tela de login; o Auth.js gera
  um token, envia um link por e-mail e, ao clicar, o usuário é autenticado.

## Mudanças técnicas principais

1. `src/lib/auth.ts` — adicionado o provider `Resend` e generalizado o callback
   `signIn` para que **qualquer provider** (Amazon e Resend) passe pela função
   `signInDecision`/`authorizeSignIn`. Isso evita que a adição do Resend abra o
   sistema para e-mails não autorizados.
2. `src/lib/sign-in-decision.ts` — recebe o provider e atualiza `amazonSub`
   apenas quando o login é pela Amazon.
3. `src/lib/jwt-callback.ts` — generalizada a promoção de role no primeiro
   login, garantindo que um usuário criado pelo magic link como `DRIVER` seja
   elevado para `SUPERVISOR`, `ACCOUNT_MANAGER` ou `ADMIN` conforme
   `allowed_emails`.
4. `src/app/(auth)/login/login-form.tsx` — nova UI com tabs **Amazon** e
   **E-mail**, validação de e-mail, estados de loading/sucesso/erro.
5. `src/app/auth-error/page.tsx` — mensagens específicas para
   `?error=unauthorized` e `?error=deactivated`.

## Variáveis de ambiente

Recomendamos **chaves separadas** das usadas para cobrança de CNH:

| Variável | Descrição |
|----------|-----------|
| `AUTH_RESEND_KEY` | API key do Resend usada exclusivamente para envio dos links mágicos de login. |
| `AUTH_RESEND_FROM` | Remetente autorizado e verificado no Resend. Padrão: `TRC Brasil <trc-brasil@instalog.com.br>`. |

### Decisão sobre reutilização

**Escolha:** criar `AUTH_RESEND_KEY`/`AUTH_RESEND_FROM` separadas, em vez de
reutilizar `RESEND_API_KEY`/`EMAIL_FROM`.

**Justificativas:**

- O Auth.js provider Resend já espera esses nomes por padrão.
- Permite usar uma API key distinta para autenticação, com permissões e
  rotação independentes da chave de e-mails de negócio.
- Facilita auditoria: fica claro no dashboard do Resend e nas variáveis da
  Vercel qual chave pertence a qual fluxo.

### Decisão sobre o remetente

**Escolha:** manter o remetente institucional `TRC Brasil <trc-brasil@instalog.com.br>`
como padrão.

**Justificativas:**

- O domínio `instalog.com.br` já precisa estar verificado para a cobrança de CNH.
- Evita criar um novo remetente que os usuários não reconheçam.
- Se no futuro for desejado um remetente específico (ex.: `login@instalog.com.br`),
  basta alterar a variável `AUTH_RESEND_FROM` sem tocar no código.

## Como adicionar um administrador

1. Insira ou atualize o registro na tabela `allowed_emails`:

   ```sql
   INSERT INTO allowed_emails (email, role, status, created_by)
   VALUES ('nome.sobrenome@instalog.com.br', 'ADMIN', 'ACTIVE', 'seu-email@instalog.com.br')
   ON CONFLICT (email) DO UPDATE SET
     role = EXCLUDED.role,
     status = EXCLUDED.status,
     updated_at = NOW();
   ```

2. O usuário acessa `/login`, seleciona **E-mail**, digita o endereço e clica
   em **Receber link de acesso**.

3. O Auth.js envia o link. Após clicar, o usuário é autenticado e, se for o
   primeiro acesso, a role é promovida automaticamente para a role definida em
   `allowed_emails`.

## Regras de segurança

- **Lista fechada continua valendo.** Apenas e-mails em `allowed_emails` com
  `status = 'ACTIVE'` conseguem logar. E-mails desconhecidos ou `REVOKED` são
  redirecionados para `/auth-error?error=unauthorized`.
- **Não rebaixamento de role.** Usuários que já possuem uma role maior que a
  registrada em `allowed_emails` mantêm a role atual. A promoção só ocorre quando
  o usuário está como `DRIVER`.
- **Tokens de uso único.** O Auth.js gerencia o token do magic link; não
  armazenamos tokens manualmente no banco.
- **Sem dependência cruzada.** O Login with Amazon continua funcionando mesmo que
  `AUTH_RESEND_KEY` não esteja configurado.
- **Sem segredos versionados.** As chaves nunca devem ser commitadas; use apenas
  variáveis de ambiente (Vercel, GitHub Secrets, `.env` local).

## Testes

- `src/app/(auth)/login/__tests__/login-page.test.tsx` — cobre renderização das
  tabs, chamada `signIn("resend", { email, redirect: false })`, validação de
  e-mail e mensagem de erro.
- `src/lib/__tests__/jwt-callback.test.ts` — cobre promoção de role via Resend,
  não-rebaixamento e rejeição de `AllowedEmail` `REVOKED`.
- `src/lib/__tests__/driver-login-authorization.test.ts` — cobre autorização de
  login para e-mails ativos, revogados e desconhecidos.

## Próximos passos sugeridos (fora do escopo atual)

- Monitorar taxa de entrega dos e-mails de login no dashboard do Resend.
- Avaliar a criação de um remetente dedicado (`login@instalog.com.br`) se o
  volume de magic links crescer.
- Considerar rate limiting na rota de envio de magic link para mitigar
  enumeração de e-mails.
