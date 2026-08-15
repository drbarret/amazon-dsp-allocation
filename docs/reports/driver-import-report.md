# Relatório de Importação de Motoristas

**Data:** 2026-08-14
**Commit:** `2c834fd`
**CI Run:** `31839243840` (success)
**Deploy:** Production, SHA `2c834fd` (https://amazon-dsp-allocation-illt.vercel.app)

---

## 1. Contagens Antes e Depois

### Antes da importação
| Tabela | Contagem |
|--------|----------|
| `users` | 1 (admin) |
| `driver_profiles` | 0 |
| `allowed_emails` | 9 (staff) |
| `allowed_emails` ACTIVE | 9 |

### Após 1ª execução (`--apply`)
| Tabela | Contagem |
|--------|----------|
| `users` | 125 (1 admin + 124 drivers) |
| `driver_profiles` | 124 |
| `allowed_emails` | 133 (9 staff + 124 drivers) |
| `allowed_emails` ACTIVE | 133 |
| `users` active=true | 84 (1 admin + 83 ACTIVE drivers) |
| `users` active=false | 41 (INACTIVE drivers) |
| `users` role=DRIVER | 124 |

### Prova de idempotência (2ª execução)
| Métrica | Valor |
|---------|-------|
| Criados | 0 allowed_emails, 0 users, 0 driver_profiles |
| Atualizados | 0 allowed_emails, 0 users, 0 driver_profiles |
| Já existentes (skip) | 124 |
| Falhas | 0 |

**Contagens após 2ª execução: idênticas à 1ª.** Nenhuma duplicação, nenhuma alteração.

---

## 2. Onde o Bloqueio do Motorista Inativo é Imposto

**Arquivo:** `src/lib/auth.ts`, linhas 56-63

```56:63:src/lib/auth.ts
          // Refuse deactivated users
          if (!existingUser.active) {
            await writeAuditLog({
              eventType: "ACCESS_DENIED",
              targetUserId: existingUser.id,
              metadata: { reason: "user_deactivated", email: user.email },
            });
            return "/auth-error?error=deactivated";
          }
```

**Decisão de design:** Os 41 motoristas INACTIVE são importados com:
- `AllowedEmail.status = "ACTIVE"` (para estarem no sistema)
- `User.active = false` (para serem barrados no login)

O bloqueio ocorre em duas camadas:
1. **Camada 1** (`access-control.ts:11-18`): `isPreRegistered()` verifica `AllowedEmail.status === "ACTIVE"`. Os INACTIVE têm status ACTIVE no AllowedEmail, então passam.
2. **Camada 2** (`auth.ts:56-63`): O callback `signIn` verifica `existingUser.active`. Como pré-criamos o `User` com `active=false`, o `existingUser` é encontrado e a verificação barra o login.

Isso funciona porque o `User` é pré-criado durante a importação. Quando o motorista tenta fazer login pela primeira vez, o adapter do NextAuth encontra o `User` existente por e-mail e vincula a conta OAuth a ele, sem tentar criar um duplicado. O callback `signIn` então vê `existingUser.active === false` e redireciona para `/auth-error?error=deactivated`.

**Os 9 e-mails de staff existentes não foram afetados.** Nenhum dos 124 e-mails da planilha coincide com os 9 staff (domínios diferentes: `gmail.com`/`hotmail.com`/etc. vs `instalog.com.br`/`gmail.com` do admin).

---

## 3. Como o Teste de Login ACTIVE vs INACTIVE Foi Exercitado

**Arquivo:** `src/lib/__tests__/driver-login-authorization.test.ts` (7 testes)

O teste simula a lógica exata do callback `signIn` de `auth.ts:37-82`, extraída como função pura `simulateSignInDecision()`:

- **ACTIVE driver (existing user, active=true) → allowed** (teste linha 67)
- **INACTIVE driver (existing user, active=false) → refused com reason="user_deactivated"** (teste linha 78)
- **New user com AllowedEmail ACTIVE → allowed** (teste linha 90)
- **New user com AllowedEmail REVOKED → refused** (teste linha 101)
- **INACTIVE user mesmo com AllowedEmail ACTIVE → refused** (teste linha 152)

A Camada 1 (`authorizeSignIn`) já era testada em `access-control.test.ts` (12 testes existentes).

**Nota:** Não é possível testar o fluxo OAuth completo sem o provedor Amazon. O teste exercita a mesma função de autorização que o callback `signIn` usa, com as mesmas estruturas de dados.

---

## 4. Reativação — Já é Possível pela UI Administrativa

**SIM, a reativação já existe.** Não foi necessário construir nada novo.

**Arquivo:** `src/app/(protected)/admin/users/actions.ts`, função `reactivateUser` (linhas 141-172):

```141:172:src/app/(protected)/admin/users/actions.ts
export async function reactivateUser(targetUserId: string) {
  const session = await requireAdminOrAccountManager();
  const actorId = session.user.id;

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, active: true },
  });
  if (!target) {
    return { success: false, error: "Usuário não encontrado." };
  }

  if (target.active) {
    return { success: false, error: "Usuário já está ativo." };
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { active: true },
  });

  await writeAuditLog({
    eventType: "USER_ACTIVATED",
    actorId,
    targetUserId,
    oldValue: { active: false },
    newValue: { active: true },
  });

  revalidatePath("/admin/users");
  return { success: true };
}
```

A UI em `admin/users/client.tsx` (linhas 116-130, 340-355) tem o botão "Reativar usuário" com ícone `ShieldCheckIcon` que chama `handleReactivate`. O fluxo:
1. Admin/Gerente de Contas acessa `/admin/users`
2. Localiza o motorista inativo (badge "Inativo" vermelho)
3. Clica no ícone de escudo verde (ShieldCheck)
4. Confirma no diálogo
5. `User.active` é setado para `true`
6. Motorista pode fazer login normalmente

**Nenhuma lacuna.** A reativação está completa.

---

## 5. Linhas da Planilha Que Não Importaram

**Nenhuma.** Todas as 124 linhas foram importadas com sucesso. Zero falhas.

---

## 6. CI e Deploy

- **CI Run ID:** `31839243840`
- **Conclusão:** `success`
- **SHA:** `2c834fd7ffd8195ebf7ac5a3869dbe43932e2666`
- **origin/main == HEAD:** Sim
- **Deploy Production:** SHA `2c834fd` (https://amazon-dsp-allocation-illt.vercel.app)

---

## 7. Verificações de Qualidade

| Comando | Resultado |
|---------|-----------|
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | 0 errors |
| `npm run build` | Compiled successfully |
| `npx vitest run` | 196 tests passed (9 files) |

---

## 8. Arquivos Criados/Modificados

| Arquivo | Descrição |
|---------|-----------|
| `scripts/import-drivers.mjs` | Script de importação idempotente (dry-run por padrão, `--apply` para gravar) |
| `src/lib/driver-import-parser.ts` | Parser/normalizador puro (funções extraídas para testabilidade) |
| `src/lib/__tests__/driver-import-parser.test.ts` | 48 testes unitários do parser |
| `src/lib/__tests__/driver-login-authorization.test.ts` | 7 testes de autorização de login (ACTIVE vs INACTIVE) |
| `package.json` | Adicionado `xlsx` como devDependency |
| `package-lock.json` | Lockfile atualizado |

**Nenhum arquivo de `src/lib/access-control.ts`, `auth.ts`, ou `jwt-callback.ts` foi modificado.**

**Nenhum dado pessoal foi commitado.** A planilha não está no repositório.
