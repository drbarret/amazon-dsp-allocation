# Criptografia de CPF e Telefone

## Algoritmo

- **Criptografia:** AES-256-GCM com IV aleatório de 96 bits e auth tag de 128 bits.
- **Formato de armazenamento:** `iv:authTag:ciphertext` (todos hex-encoded).
- **Chave:** `FIELD_ENCRYPTION_KEY` (32 bytes, hex-encoded ou derivada via HMAC-SHA256).

## Índice cego do CPF (tradeoff)

O CPF precisa ser unicamente pesquisável para detectar motoristas duplicados, mas não pode ser armazenado em texto plano.

**Solução adotada:** índice cego determinístico via HMAC-SHA256.

- O CPF é normalizado (apenas dígitos) e passado por `HMAC-SHA256(chave, cpf_normalizado)`.
- O resultado é armazenado na coluna `cpfBlindIndex` (única, indexada).
- A chave do índice (`FIELD_BLIND_INDEX_KEY`) é **diferente** da chave de criptografia.

### Tradeoff

| Vantagens | Desvantagens |
|-----------|-------------|
| Busca exata de duplicatas sem revelar o CPF | CPFs idênticos produzem índices idênticos (determinístico) |
| Chave separada limita o impacto de vazamento de uma das chaves | Um atacante com a chave do índice pode confirmar se um CPF específico existe no sistema |
| Não requer descriptografar todos os registros para buscar | Não suporta busca por prefixo ou substring |

### Alternativas consideradas e rejeitadas

1. **Criptografia determinística (AES-256-SIV):** mesma coluna para busca e armazenamento, mas vazar a chave de criptografia revela todos os CPFs.
2. **Hash simples (SHA-256):** vulnerável a rainbow tables; CPFs têm espaço de busca pequeno (11 dígitos = 10^11 combinações).
3. **Envelope encryption com KMS:** adiciona latência e custo; desproporcional para a escala atual.

A separação de chaves (criptografia vs. índice) segue o princípio de privilégio mínimo: um serviço que só precisa verificar duplicatas não precisa da chave de descriptografia.

## Revogação de privilégios (role / active)

A role e o status `active` do usuário são cacheados no JWT por até **15 segundos** (`ROLE_FRESHNESS_MS = 15_000`). Após esse intervalo, o callback `jwt` do NextAuth re-lê os valores do banco de dados.

**Garantia:** uma desativação ou rebaixamento de role entra em vigor em **no máximo 15 segundos** após a mutação no banco.

**Decisão de design:** 15s foi escolhido como o ponto de equilíbrio entre segurança e custo. Alternativas consideradas:

1. **`sessionVersion` / `tokenValidAfter` no model `User`:** invalidaria o token imediatamente na próxima requisição, mas exigiria uma leitura de banco em **toda** requisição de **todo** usuário autenticado — custo desproporcional para um sistema com dezenas de usuários ativos e tráfego de página.

2. **Re-leitura de `active` nos paths privilegiados (server actions):** protegeria as mutações, mas não as páginas — um usuário desativado ainda veria `/admin/users` por até 15s. Defesa em profundidade é preferível a proteção parcial.

3. **Manter 60s:** janela longa demais para um sistema com PII real (CPF, telefone). Um insider malicioso ciente da desativação iminente teria 60s para exfiltrar dados.

4. **15s (escolhido):** reduz a janela em 4× sem adicionar latência de banco ao caso comum. Combinado com as defesas existentes (signIn bloqueia usuários desativados, `requireAuth` verifica `active`, audit trail captura todas as ações), o risco residual é aceitável para o perfil de ameaça atual.

**Controles compensatórios existentes:**
- O callback `signIn` bloqueia usuários com `active = false` no momento do login (independente do cache).
- `requireAuth()` em `src/lib/authz.ts` verifica `active` na sessão e redireciona se `false`.
- Toda mutação administrativa escreve `audit_log` com `actorId` — ações maliciosas são rastreáveis post-hoc.
- O sistema não armazena CPF/telefone em texto plano (AES-256-GCM); mesmo com acesso de ADMIN, a exfiltração exige a chave de criptografia.
