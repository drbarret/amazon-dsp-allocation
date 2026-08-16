# Protótipo visual de UX — Amazon DSP Allocation

Protótipo **estático e navegável** do redesenho de UX proposto em `docs/plans/ux-redesign.md`, construído para o usuário **ver** a interface antes de aprovar a implementação.

## O que é (e o que não é)

- **É** HTML + CSS + JS mínimo, sem build, sem dependência, sem servidor. Abra `index.html` com duplo clique.
- **É** fiel aos valores **medidos** da referência (`https://2u65rfunwtu6y.kimi.page`) — cores, tipografia, raios, sombras e espaçamentos extraídos via `getComputedStyle` (inventário em `reference-tokens.json` e `reference-tokens-2.json`).
- **NÃO é** o app em produção. Não usa `src/`, não lê banco, não envia e-mail, não autentica.
- **Todos os dados são fictícios** (nomes, e-mails `@exemplo-demo.com`, métricas). Nenhum dado real de motorista, nenhum PII.

## Páginas

| Arquivo | Tela |
|---|---|
| `index.html` | Dashboard (KPIs, próximas semanas, atalhos) |
| `dispatch.html` | Dispatch (seletor de semana, vagas, resultado da distribuição) |
| `drivers.html` | Motoristas (busca, GNV, categoria) |
| `cnh.html` | Cobrar CNH (seleção múltipla, resumo pós-envio) |
| `users.html` | Usuários (nome + e-mail secundário, ações com rótulo) |
| `behavior.html` | Comportamento (skeleton vs. carregado — correção do falso vazio) |
| `login.html` | Login (molde unificado) |

## Cor de marca

A cor de marca é **uma variável CSS** (`--brand`). O seletor no canto inferior direito troca ao vivo entre:

- **Âmbar (padrão)** — `#F59E0B`, medido do item ativo da sidebar da referência;
- **Azul** — `#1D4ED8`, proposta original do plano.

## Responsividade

A referência **não é responsiva** (sidebar fixa de 256px esmaga o conteúdo em 390px, sem hambúrguer). O protótipo **corrige** isso: abaixo de 900px a sidebar vira gaveta com hambúrguer. Essa é uma decisão deliberada documentada no relatório final.

## Screenshots

- `shots/reference/` — screenshots da referência (desktop 1440×900, mobile 390×844).
- `shots/` — screenshots do protótipo (mesmos tamanhos).

## Isolamento

Todo o entregável vive em `docs/ux-preview/`. Nenhum arquivo de aplicação foi alterado. Nada foi commitado.
