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
