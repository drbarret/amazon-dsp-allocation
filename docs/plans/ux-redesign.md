# Plano de Redesenho de UX — Amazon DSP Allocation

> **Status:** proposta para decisão. Nada deste documento está implementado.
> **Data:** 2026-08-16 · **HEAD:** `e6e0383` · **Escopo:** somente apresentação, navegação e fluxo de interação das 11 telas existentes. Nenhuma regra de negócio, permissão, server action ou schema muda.

## Como este documento foi produzido (e seus limites de evidência)

- **Referência** (`https://2u65rfunwtu6y.kimi.page/`): as 7 páginas foram lidas via fetch de conteúdo (estrutura, textos, hierarquia de informação). O navegador embutido do ambiente não registrou abas externas, portanto **cores hex, tipografia computada, raios e sombras exatos da referência não foram verificados via computed style** — estão marcados como "não verificado" onde relevante. A anatomia dos componentes (o que existe e em que ordem) está verificada pelo conteúdo servido.
- **App atual**: as 4 telas públicas foram fotografadas localmente (desktop 1440px e mobile 390px) com Playwright contra `next dev` local — screenshots em `docs/ux-reference/`. As 7 telas protegidas **não foram fotografadas**: exigem sessão OAuth Amazon real e esta tarefa proíbe criar dados ou autenticar em produção. A análise delas é por leitura integral do código-fonte (arquivo:linha citado em cada achado).
- Observação incidental: nos screenshots locais a fonte Geist não carregou (sem acesso ao Google Fonts no sandbox), caindo para serifada de sistema. Em produção a fonte carrega, mas isso evidencia que **não há `font-display` fallback ajustado nem stack de fallback coerente** — o layout muda visivelmente quando a webfont falha.

---

## 1. Diagnóstico

Problemas ordenados por impacto no trabalho real do supervisor (quem opera a escala toda semana).

### P1 — A navegação não diz onde você está

**Evidência:** `src/app/(protected)/layout.tsx:86-98` — os links do menu são todos renderizados com a mesma classe (`text-zinc-600 ... hover:bg-zinc-100`); não existe `usePathname` nem `aria-current`. O supervisor alterna entre Dispatch / Comportamento / Motoristas / Cobrar CNH dezenas de vezes por dia sem nenhum indicador de página ativa. Na referência, o item ativo do menu é visualmente distinto (verificado no conteúdo servido: navegação horizontal persistente em todas as 7 páginas com estado ativo).

**Impacto:** erro de contexto (operar na tela errada), retrabalho, sensação de "sistema cru".

### P2 — O dashboard não trabalha para o supervisor

**Evidência:** `src/app/(protected)/dashboard/page.tsx:14-54` — a tela inteira é: saudação, um cartão "Cadastro concluído" e um placeholder tracejado "Disponibilidade semanal — em breve". Para SUPERVISOR/ACCOUNT_MANAGER/ADMIN (que também caem nesta mesma tela) não há **nenhuma** informação operacional: nem semana atual, nem contagem de vagas, nem status da escala, nem atalhos. A referência mostra o padrão esperado: cartões de KPI (Motoristas Ativos, Escalas Geradas, Próximo Envio), lista "Status das Próximas 5 Semanas" com pílula de status e cartões de ação rápida.

**Impacto:** a página mais visitada do sistema é uma página morta; o supervisor entra e imediatamente tem que navegar para outra tela para saber qualquer coisa.

### P3 — Tabelas operacionais sem densidade, sem hierarquia e com ações invisíveis

**Evidência:**
- `src/app/(protected)/admin/users/client.tsx:296-309` — tabela com **10 colunas** (Usuário, E-mail, Papel, Status, Perfil, CNH, Cidades, Veículo, Último Acesso, Ações) sem nenhuma priorização: e-mail com ícone ocupa largura de coluna nobre, enquanto ações destrutivas são ícones fantasmas de 16px (`size-4` em botões `ghost`, linhas 522-570) que só se revelam pelo `title` no hover.
- `src/app/(protected)/dispatch/client.tsx:297-362` — a tabela de vagas mistura data, categoria (badge), turno, quantidade e ações com o mesmo peso visual; o número de vagas (a informação mais importante) é texto corrido (`px-4 py-3 text-zinc-700`, linha 334).
- Padrão repetido em `behavior/client.tsx:283-324` e `cnh/client.tsx:168-231`: cabeçalho `text-xs uppercase tracking-wider text-zinc-500` sobre fundo `bg-zinc-50` — contraste baixo para leitura rápida em ambiente de operação (galpão, celular, sol).

**Impacto:** leitura lenta, clique errado em ação destrutiva (excluir vaga / desativar usuário são ícones gêmeos de lápis/lixeira), e em telas médias a tabela de usuários exige scroll horizontal para chegar nas ações.

### P4 — Estados vazios, de carregamento e de feedback são inconsistentes ou ausentes

**Evidência:**
- Carregamento: `dispatch/client.tsx:311` usa "Carregando vagas..." em texto corrido dentro da tabela; `behavior/client.tsx` não tem **nenhum** estado de carregamento — a tabela renderiza "Nenhuma infração registrada" (linha 317) enquanto `listInfractions()` ainda não respondeu (o `useEffect` de carga, linhas 111-114, não seta flag de loading), o que mostra um falso "vazio" ao abrir a tela.
- Vazio: cada tela improvisa um texto cinza (`text-zinc-400`) dentro de um `<td>` — sem ícone, sem orientação do próximo passo (ex.: "Nenhuma vaga cadastrada para esta semana" não diz que o botão "Nova Vaga" resolve).
- Feedback: `toast` (sonner) é usado em todas as mutações — ponto positivo — mas o resumo pós-envio de CNH (`cnh/client.tsx:134-165`) é um bloco ad-hoc que não segue o padrão de nenhum outro componente.

**Impacto:** o supervisor não sabe se a tela está carregando, vazia ou quebrada — principalmente em `/behavior`, que hoje mente "nenhuma infração" durante a carga.

### P5 — Identidade e hierarquia tipográfica amadoras na porta de entrada

**Evidência:** `src/app/page.tsx:13-27` — a landing é um título, um parágrafo e um botão "Entrar" numa tela branca, sem marca, sem contexto de operação, sem o que o sistema faz. `src/app/(auth)/login/page.tsx:18-26` mistura duas marcas ("ILLT" cinza + "Amazon DSP" âmbar) sem hierarquia clara e usa `bg-slate-50` aqui versus `bg-zinc-50` no resto do app (`page.tsx:13`, `forbidden/page.tsx:7`) — inconsistência de tokens no primeiro contato do usuário. O metadata do app (`src/app/layout.tsx:18`) ainda diz "Amazon DSP Driver Allocation" em inglês enquanto a UI é pt-BR.

**Impacto:** primeira impressão de protótipo; motorista novo não sabe se está no lugar certo.

### Demais achados (agrupados, com evidência)

**Acessibilidade**
- Menu sem `aria-current` e sem `<nav aria-label>` (`(protected)/layout.tsx:86`).
- Ações destrutivas só com `title` — sem `aria-label` textual (ex.: `admin/users/client.tsx:533` "Desativar usuário" é só um ícone `ShieldOffIcon`; leitores de tela recebem apenas o title via tooltip, que não é anunciado de forma confiável).
- Badge é um `<div>` (`components/ui/badge.tsx:36-38`) — status como "Ativo/Inativo" não têm papel semântico; aceitável, mas combinado com cor como único indicador (linha inteira cinza para inativo, `admin/users/client.tsx:316-321`) falha em contraste para daltônicos.
- Ordem de tabulação em `/admin/users`: 10 colunas × N linhas com selects e botões inline tornam a navegação por teclado longa e sem atalhos.

**Mobile**
- O menu vira uma faixa com scroll horizontal (`overflow-x-auto`, `(protected)/layout.tsx:86`) sem indicador de que há mais itens — em 390px "Cobrar CNH" e "Usuários" ficam fora da tela (verificado no screenshot mobile do login: o padrão de largura já aperta; no menu com 5-6 itens o corte é certo pela soma das larguras dos labels).
- Tabelas usam `overflow-x-auto` (bom), mas sem coluna fixa: em `/admin/users` no celular o usuário rola horizontalmente e perde o nome do usuário de vista ao chegar nas ações.
- Botões de ação principais empilham em `flex-col` (`dispatch/client.tsx:229-251`) — correto — mas sem largura total no mobile, ficando pequenos e desalinhados à esquerda.

**Inconsistências entre telas**
- Fundo: `bg-slate-50` (login, onboarding) vs `bg-zinc-50` (resto do app).
- Título de página: todas usam `text-2xl font-bold` (bom), mas o par de título+descrição+ações à direita é refeito à mão em cada tela com pequenas variações (`dispatch/client.tsx:229-252`, `behavior/client.tsx:182-196`, `cnh/client.tsx:115-131`, `admin/users/client.tsx:268-281`).
- Badge variants `success/warning/muted` existem (`components/ui/badge.tsx:17-22`) mas o dispatch usa `muted` para categoria de veículo — semântica errada (categoria não é "status apagado").

**Texto técnico vazando**
- `cnh/client.tsx:100` e `:148`: "RESEND_API_KEY ausente" exposto ao usuário no toast e no resumo de envio. O supervisor não deve ver nome de variável de ambiente.
- `behavior/client.tsx:189`: "A punição é definida pelo tipo, nunca pelo supervisor" — texto de regra de negócio interna na UI; útil como orientação, mas redigido como documentação de código.

---

## 2. Sistema de design proposto

Princípio: **adotar a linguagem da referência (densidade operacional, KPIs, pílulas de status, seletor de semana) sobre os tokens já existentes (Tailwind 4 + CSS variables em `globals.css`)**, sem trocar a stack nem introduzir biblioteca nova.

### 2.1 O que vem da referência (verificado no conteúdo servido)

- Cabeçalho com marca à esquerda ("ILLT - Escala" + subtítulo "Amazon DSP Manager"), navegação horizontal central e badge de versão à direita ("v1.0 - Sistema de Escala").
- Cartões de KPI: título pequeno, número grande, legenda de contexto ("cadastrados no sistema").
- Lista de status semanal com pílula (Pendente / Enviada etc.).
- Seletor de semana como controle primário nas telas operacionais.
- Legenda de status colorida na tela de alocação (Sim / Passeio / Speed / Sem Escala / à confirmar).
- Barra de ações agrupando as ações da semana (Distribuir / Salvar / Enviar).
- Tabela densa de motoristas com colunas operacionais e ações à direita.

### 2.2 O que proponho além da referência (e por quê)

A referência é um protótipo sem dados; os tokens abaixo completam o que ela não define:

**Cores (hex).** Manter a base neutra atual (zinc) e adicionar uma cor de marca + cores semânticas de status. Os hex exatos da referência **não foram verificados** (sem computed style); proponho:

| Token | Hex | Uso |
|---|---|---|
| `brand` | `#1D4ED8` (blue-700) | marca, link ativo, ação primária — substitui o "quase preto" atual (`oklch(0.205 0 0)`, `globals.css:58`) que faz botão primário parecer desativado |
| `brand-foreground` | `#FFFFFF` | texto sobre brand |
| `surface` | `#FFFFFF` | cartões/tabelas |
| `page` | `#F4F4F5` (zinc-100) | fundo da área protegida — hoje `bg-zinc-50` (`(protected)/layout.tsx:48`); um ponto mais escuro separa melhor os cartões brancos |
| `status-success` | `#15803D` (green-700) sobre `#DCFCE7` | "Sim", "Ativo", "Enviada" |
| `status-warning` | `#B45309` (amber-700) sobre `#FEF3C7` | "à confirmar", pendências |
| `status-danger` | `#B91C1C` (red-700) sobre `#FEE2E2` | "Sem Escala", CNH vencida, destrutivo |
| `status-info` | `#1D4ED8` sobre `#DBEAFE` | "Speed", informativo |
| `status-neutral` | `#3F3F46` sobre `#F4F4F5` | "Passeio", neutro/cancelado |

Todos os pares texto/fundo acima passam em WCAG AA para texto normal (contraste ≥ 4.5:1) — verificável na implementação com qualquer checker; os pares atuais de badge (`amber-100/amber-800`, `badge.tsx:19-20`) já passam, então a proposta mantém o padrão de par texto-forte/fundo-claro.

**Tipografia.** Manter Geist (já carregada, `layout.tsx:7-15`) e definir escala explícita — hoje cada tela improvisa:

| Estilo | Classe | Uso |
|---|---|---|
| `page-title` | `text-2xl font-semibold tracking-tight` | título da tela (hoje `font-bold` — peso 600 já sustenta hierarquia com menos agressividade) |
| `section-title` | `text-base font-semibold` | títulos de bloco ("Vagas da Semana") — hoje `text-lg` (`dispatch/client.tsx:289`) |
| `kpi-value` | `text-3xl font-semibold tabular-nums` | número do KPI |
| `kpi-label` | `text-sm text-muted-foreground` | rótulo do KPI |
| `body` | `text-sm` | tabelas e texto corrido (já é o padrão) |
| `caption` | `text-xs text-muted-foreground` | metadados |

Adicionar `tabular-nums` em colunas numéricas de tabela (quantidade, atribuídas) — hoje ausente, números "dançam" na leitura.

**Espaçamento / raio / sombra.** Manter `--radius: 0.625rem` (`globals.css:75`) e a escala de espaçamento do Tailwind. Padronizar: página `p-4 sm:p-6` com `space-y-6` (já é o padrão de fato), cartão com `ring-1 ring-foreground/10` (já no `Card`), sem sombras pesadas — a referência também é plana (não verificado via computed style; inferido do estilo de protótipo Tailwind-like).

**Estados.** Todo interativo define 4 estados visíveis: default / hover / focus (`ring-2 ring-ring ring-offset-2` — hoje inconsistente entre telas) / disabled (`opacity-50` — já no Button). Todo carregamento de lista usa skeleton (linhas cinzas pulsantes) em vez de "Carregando..." textual; todo vazio usa o componente `EmptyState` (seção 4).

### 2.3 Modo claro/escuro

O tema escuro existe nos tokens (`globals.css:86-118`) mas `ThemeProvider` está com `enableSystem={false}` e `defaultTheme="light"` (`layout.tsx:34`) — ou seja, o app é efetivamente só claro. **Proposta: manter só claro neste redesenho** (decisão do usuário na seção 9); se um dia ativar escuro, os pares de status acima precisam de variantes.

---

## 3. Navegação e arquitetura de informação

### 3.1 Estrutura por papel (respeitando exatamente as permissões atuais)

As regras de exibição atuais estão em `(protected)/layout.tsx:38-45` e **não mudam** — só a apresentação:

| Item | DRIVER | SUPERVISOR | ACCOUNT_MANAGER | ADMIN |
|---|---|---|---|---|
| Início (`/dashboard`) | ✓ | ✓ | ✓ | ✓ |
| Dispatch (`/dispatch`) | — | ✓ | ✓ | ✓ |
| Comportamento (`/behavior`) | — | ✓ | ✓ | ✓ |
| Motoristas (`/drivers`) | — | ✓ | ✓ | ✓ |
| Cobrar CNH (`/cnh`) | — | ✓ | ✓ | ✓ |
| Usuários (`/admin/users`) | — | — | ✓ | ✓ |

(Verificado: `roleIsAtLeast(role, "SUPERVISOR")` inclui ACCOUNT_MANAGER e ADMIN pela hierarquia; `roleIsAtLeast(role, "ACCOUNT_MANAGER")` inclui ADMIN. Nenhuma rota muda de papel.)

### 3.2 Anatomia do novo cabeçalho

- **Barra única** (hoje são duas faixas: marca+usuário e depois o menu, `layout.tsx:50-99`): marca à esquerda, menu ao centro, usuário+sair à direita. Em desktop o menu mostra todos os itens do papel; o item ativo recebe `aria-current="page"` e estilo distinto (texto `brand` + barra inferior de 2px — padrão da referência, não verificado via computed style).
- **Mobile (<640px):** marca + botão hambúrguer que abre gaveta (sheet) com os itens empilhados e o item ativo marcado. Elimina o scroll horizontal invisível de hoje. A gaveta usa o `Dialog`/`Sheet` já disponível via base-ui (sem dependência nova).
- Nome e papel do usuário passam para um menu de usuário (avatar com iniciais) contendo "Sair" — hoje nome+papel+botão sair ocupam 3 espaços distintos no header (`layout.tsx:58-82`).

### 3.3 Indicação de contexto operacional

Toda tela protegida ganha um **cabeçalho de página** padronizado (componente `PageHeader`): título, descrição de uma linha, e à direita o `WeekSelector` quando a tela opera por semana (dispatch, e futuramente outras). Hoje o seletor de semana do dispatch fica perdido entre o título e as tabelas (`dispatch/client.tsx:254-283`); na referência ele é o controle primário logo sob o título.

---

## 4. Componentes compartilhados (lista mínima)

Todos novos em `src/components/` (app) exceto os já existentes em `src/components/ui/` (primitivos). Nenhum primitivo novo de terceiros.

| Componente | Props | Estados | Observação |
|---|---|---|---|
| `PageHeader` | `title: string; description?: string; actions?: ReactNode` | — | Padroniza o par título+descrição+ações refeito à mão 4 vezes hoje |
| `KpiCard` | `label: string; value: string\|number; hint?: string; icon?: LucideIcon; tone?: "default"\|"success"\|"warning"\|"danger"` | default, loading (skeleton) | Da referência: rótulo pequeno, valor grande, legenda |
| `StatusPill` | `tone: "success"\|"warning"\|"danger"\|"info"\|"neutral"; children` | — | Substitui o uso semântico errado de `Badge variant="muted"`; texto+fundo dos pares AA da seção 2.2 |
| `WeekSelector` | `weeks: {id, weekKey, startDate, endDate}[]; value: string; onChange(id)` | default, disabled, vazio ("Nenhuma semana cadastrada") | Hoje inline em `dispatch/client.tsx:259-279`; vira o controle primário sob o PageHeader |
| `DataTable` | `columns: ColumnDef[]; rows: T[]; loading?: boolean; empty: {title, hint?, action?}; dense?: boolean` | loading (skeleton de 5 linhas), empty (EmptyState), ready | Encapsula o padrão `overflow-x-auto rounded-lg border bg-white` repetido 6 vezes; cabeçalho sticky opcional; primeira coluna fixa no mobile quando `dense` |
| `EmptyState` | `icon?: LucideIcon; title: string; hint?: string; action?: {label, onClick}` | — | Substitui os `<td> text-zinc-400` improvisados |
| `ActionBar` | `children` (botões) | — | Faixa que agrupa ações da semana (Distribuir / Nova Vaga), alinhada à direita no desktop, botões full-width empilhados no mobile |
| `ConfirmDialog` | `title; description; confirmLabel; tone?: "default"\|"destructive"; onConfirm; open; onOpenChange` | open, pending | Hoje 3 diálogos de confirmação reimplementados (dispatch delete, admin deactivate/revoke) |
| `UserMenu` | `name; roleLabel` | open | Avatar + dropdown com Sair |

`Badge` (ui) permanece para casos neutros; `StatusPill` é o componente semântico. `toast` (sonner) permanece como canal de feedback — padronizar redação: sem nomes de variáveis de ambiente, sempre com ação consequente ("Não foi possível enviar. Tente novamente." em vez de expor `RESEND_API_KEY`).

---

## 5. Redesenho tela por tela

Para cada tela: o que muda / antes → depois / o que **não** muda.

### 5.1 `/` (landing)
- **Muda:** de tela branca genérica para página de entrada com marca, uma linha do que o sistema faz e botão "Entrar" primário grande. Fundo `page`, cartão central.
- **Antes → depois:** título "Amazon DSP Driver Allocation" + parágrafo + botão (`page.tsx:13-27`) → marca + "Sistema de escala e alocação de motoristas" + Entrar.
- **Não muda:** redirect para `/dashboard` quando autenticado (`page.tsx:8-10`); nenhuma rota nova.

### 5.2 `/login`
- **Muda:** fundo `slate-50` → `page` (consistência); hierarquia da marca unificada (uma marca só, decisão do usuário — seção 9); erros (`deactivated`, `unauthorized`) mantidos em `Alert` destrutivo, agora também com ícone e título ("Conta desativada" / "E-mail não autorizado") em vez de só texto corrido.
- **Não muda:** fluxo `signIn("amazon")` (`login/page.tsx:48-57`), textos de erro existentes.

### 5.3 `/auth-error`
- **Muda:** entra no mesmo molde visual do login (cartão central, marca); botão "Voltar ao login" vira `Button` padrão em vez de link estilizado à mão (`auth-error/page.tsx:20-25`).
- **Não muda:** mensagem e destino do link.

### 5.4 `/forbidden`
- **Muda:** idem auth-error (molde unificado); adiciona caminho de retorno contextual: se o usuário tem sessão, "Voltar ao início" primário (já existe, `forbidden/page.tsx:20-25`).
- **Não muda:** mensagem e lógica.

### 5.5 `/onboarding`
- **Muda:** `Progress value={0}` fixo (`onboarding-form.tsx:84`) — hoje mostra 0% eternamente — vira indicador de etapas real ("Dados pessoais → Veículo → Preferências") ou é removido; agrupamento visual em 3 seções com `section-title`; botão de submit deixa de ser `sticky` dentro do cartão (linha 262) e passa a rodapé fixo da página no mobile; fundo `slate-50` → `page`.
- **Não muda:** campos, validações, `submitOnboarding`, regra de 1-3 cidades, consentimento LGPD.

### 5.6 `/dashboard`
- **Muda (maior ganho):** vira dashboard operacional por papel.
  - SUPERVISOR+: linha de `KpiCard`s com dados **já disponíveis** nas queries existentes (motoristas ativos — já contado em `/drivers`; vagas da semana — já listado em `/dispatch`; CNHs vencidas — já listado em `/cnh`; infrações pendentes — já listado em `/behavior`) + lista "Próximas semanas" com `StatusPill` + `ActionBar` de atalhos para as 4 telas operacionais. **Nenhuma query nova de negócio** — apenas composição dos dados que as páginas irmãs já buscam (uma server page pode chamar os mesmos `prisma.findMany` de hoje).
  - DRIVER: mantém o cartão de confirmação, mas com hierarquia corrigida e sem o placeholder tracejado "em breve" (`dashboard/page.tsx:41-53`) — placeholder de fase futura sai do caminho principal (vai para seção discreta ou é removido; decisão do usuário).
- **Não muda:** quem vê o quê (a tela já é comum a todos os papéis); nenhum dado novo exposto além do que cada papel já vê nas telas dedicadas.

### 5.7 `/dispatch`
- **Muda:** `WeekSelector` promovido a controle primário no `PageHeader`; `ActionBar` com "Distribuir vagas" (primário) e "Nova Vaga" (secundário); tabelas via `DataTable` com skeleton; resultado da distribuição vira seção com `KpiCard`s (atribuídas / não atribuídas / abaixo da cota / CNH vencida — hoje badges cinzas, `dispatch/client.tsx:424-430`) + tabelas; asterisco de CNH vencida (linha 467-469) ganha legenda visível ("* CNH vencida") em vez de tooltip.
- **Não muda:** `runDistribution`, CRUD de vagas, diálogos, regra de exibição de motoristas.

### 5.8 `/behavior`
- **Muda:** corrige o falso vazio — `DataTable` com `loading` enquanto `listInfractions` não responde; avisos de reincidência (hoje bloco âmbar ad-hoc, `behavior/client.tsx:199-237`) viram seção com `StatusPill tone="warning"` e ação clara; fila de aprovação e tabela de punições no padrão `DataTable`; texto "A punição é definida pelo tipo..." movido para `hint` discreto sob o título.
- **Não muda:** fluxos de marcar/aprovar/rejeitar/escalar, diálogo de marcação, permissões (`canApprove`).

### 5.9 `/drivers`
- **Muda:** tabela via `DataTable` com busca mantida; coluna GNV: o checkbox + badge "GNV" (hoje dois elementos soltos, `drivers/client.tsx:122-136`) viram um controle único com `aria-label` já existente preservado; badge de categoria de veículo sai de `muted` para `StatusPill tone="neutral"`.
- **Não muda:** `setDriverGnvMarking`, filtro client-side, colunas existentes. (CPF/Transporter ID da referência **não entram** — ver seção 8.)

### 5.10 `/cnh`
- **Muda:** resumo pós-envio vira bloco padronizado (sucesso/avisos/falhas com `StatusPill`), sem expor `RESEND_API_KEY` — vira "E-mail não configurado no ambiente; avise o administrador."; linha selecionada mantém destaque (hoje `bg-emerald-50/40`, `cnh/client.tsx:191`) com tom neutro de seleção; botão principal com contagem já existente preservado.
- **Não muda:** `collectCnh`, seleção, guarda de auto-seleção, textos de regra (reenvio permitido).

### 5.11 `/admin/users`
- **Muda (tela mais densa):** tabela de 10 colunas reorganizada — E-mail perde ícone e vira texto secundário sob o nome (padrão da referência: nome + linha secundária); "Perfil/CNH/Cidades/Veículo" agrupados numa coluna "Motorista" com edição inline mantida; ações destrutivas ganham `aria-label` textual e confirmação via `ConfirmDialog` (já existe, só padroniza); busca mantida; primeira coluna (usuário) fixa no scroll horizontal mobile.
- **Não muda:** todas as actions (`changeUserRole`, `deactivateUser`, etc.), diálogos de edição, regras de convite, limites de cidade.

---

## 6. Ordem de execução em fatias entregáveis

Cada fatia vai a produção sozinha, sem quebrar as demais. Critérios de aceite verificáveis.

**Fatia 0 — Fundação de tokens (½ dia)**
- Adicionar tokens de cor de marca/status em `globals.css` (somente adições; nenhum token existente removido), alinhar fundos (`page` único), metadata pt-BR.
- Aceite: `pnpm typecheck` e `pnpm lint` verdes; app visualmente idêntico exceto fundo unificado; `git diff` só em `globals.css`/`layout.tsx`.

**Fatia 1 — Componentes compartilhados (1-2 dias)**
- Criar `PageHeader`, `KpiCard`, `StatusPill`, `EmptyState`, `DataTable`, `ConfirmDialog`, `ActionBar`, `WeekSelector`, `UserMenu` em `src/components/` com stories mínimas ou página de demonstração interna temporária (removida antes do merge, ou testada via teste de render).
- Aceite: cada componente renderiza seus estados (loading/empty/ready) num teste de render jsdom; nenhuma tela de produção alterada.

**Fatia 2 — Navegação (1 dia)**
- Header único com estado ativo (`usePathname` + `aria-current`), gaveta mobile, `UserMenu`.
- Aceite: em 1440px todos os itens do papel visíveis com ativo marcado; em 390px menu abre via hambúrguer e fecha ao navegar; `pnpm test` verde (349 testes de servidor não tocam em UI, devem permanecer verdes).

**Fatia 3 — Telas públicas (½ dia)**
- Landing, login, auth-error, forbidden no molde unificado.
- Aceite: screenshots antes/depois; fluxo de login inalterado (teste manual do redirect OAuth em ambiente com credenciais).

**Fatia 4 — Dashboard (1 dia)**
- KPIs por papel com dados já existentes + lista de semanas + atalhos.
- Aceite: supervisor vê contagens que batem com as telas dedicadas (mesma fonte de dados); driver vê sua confirmação; nenhuma query nova de negócio.

**Fatia 5 — Dispatch (1 dia)**
- `WeekSelector` no header, `ActionBar`, `DataTable`, KPIs de resultado.
- Aceite: criar/editar/excluir/distribuir vagas funcionam ponta a ponta (teste manual guiado + os testes de servidor de `dispatch` já existentes continuam verdes).

**Fatia 6 — Behavior (½ dia)**
- Corrige falso vazio (loading), padroniza seções.
- Aceite: ao abrir a tela, skeleton aparece antes dos dados; nunca mostra "Nenhuma infração" durante carga.

**Fatia 7 — Drivers + CNH (½ dia)**
- `DataTable`, `StatusPill`, resumo de envio sem vazar config.
- Aceite: toggle GNV e cobrança CNH funcionam; texto "RESEND_API_KEY" não aparece mais em nenhuma saída de UI (grep).

**Fatia 8 — Admin users (1 dia)**
- Reorganização de colunas, ações com `aria-label`, `ConfirmDialog`.
- Aceite: todas as 8 actions da tela exercitadas manualmente; tabela legível em 390px com coluna de usuário fixa.

**Fatia 9 — Onboarding (½ dia)**
- Seções, indicador de progresso real, rodapé de submit.
- Aceite: fluxo completo de cadastro em conta de teste existente; validações inalteradas.

---

## 7. Risco de regressão e como cobrir

**Fato:** o projeto tem ~349 testes de servidor e **zero** cobertura de UI/E2E (verificado: `rg --files` mostra testes apenas em `__tests__` de actions/integração; `playwright` está em devDependencies mas sem nenhum spec). Portanto, **a única proteção real contra regressão visual/de interação é E2E ou teste de render — teste de servidor não pega quebra de UI.**

Proposta mínima viável, em ordem de custo/benefício:

1. **Testes de render (jsdom + Testing Library, já em devDependencies)** para os 9 componentes novos: renderiza estados loading/empty/ready e verifica `aria-current`, `aria-label` das ações destrutivas. Custo baixo, roda no CI junto com vitest.
2. **E2E mínimo com Playwright (já instalado)** — 5 cenários que cobrem o trabalho semanal do supervisor:
   - login (mockando o callback OAuth ou usando conta de teste) → dashboard carrega com KPIs;
   - dispatch: selecionar semana → criar vaga → distribuir → resultado aparece;
   - behavior: abrir tela → skeleton → tabela (protege o bug do falso vazio);
   - cnh: selecionar motorista → botão com contagem → confirmar (com `RESEND_API_KEY` ausente, verifica degradação sem envio real);
   - admin: buscar usuário → alterar papel → toast de sucesso.
   Rodam contra ambiente local com banco de teste (o projeto já tem `scripts/test-db.mjs`). **Sem esses 5 cenários, o redesenho fica protegido só por revisão humana — seja honesto com esse risco ao aprovar as fatias 5-8.**
3. **Proteção já existente:** os 349 testes de servidor continuam sendo o guarda-rail de regra de negócio — como o redesenho não toca em actions/schema, qualquer quebra neles indica contaminação indevida da fatia (sinal de parada).
4. **Checklist manual por fatia** (screenshots antes/depois + percurso crítico) registrado no PR — obrigatório até o E2E existir.

---

## 8. Fora do escopo deste redesenho

Presentes na referência, **não entram agora** (fases futuras já mapeadas, decisão do usuário):

- **Disponibilidades** (importar .xlsx, baixar modelo) — referência `/disponibilidades`.
- **Performance/scorecard** (importar PDF/TXT, regras de impacto ±1 vaga) — referência `/performance`.
- **Logs de envio** (histórico de envio de escalas) — referência `/logs`.
- **Envio de escalas via WhatsApp** e "Próximo Envio — Sáb, até 16h, envio automático" — referência dashboard.
- **Colunas CPF e Transporter ID na tabela de motoristas** — os dados existem no cadastro (onboarding), mas exibi-los na tabela é decisão de produto (e de exposição de PII), não de UX.
- **Badge de versão "v1.0 - Sistema de Escala"** no header — decisão de identidade (seção 9).
- **Página `/vagas` pública com cartões de tipo de vaga por ciclo** — conceito inexistente no produto atual.
- **Modo escuro** — tokens existem, mas ativação é decisão separada.

---

## 9. Decisões que dependem do usuário

1. **Identidade da marca:** manter "ILLT - Escala / Amazon DSP Manager" da referência (hoje o login mistura "ILLT" + "Amazon DSP" e o resto do app usa só "Amazon DSP")? Qual o nome oficial e há logo?
2. **Grau de fidelidade à referência:** o redesenho acima adota a *linguagem* (KPIs, pílulas, seletor de semana, densidade) mas não copia pixel a pixel (hex exatos não foram verificados). Quer cópia mais fiel (exige sessão de extração de computed style com navegador controlado) ou a adaptação proposta basta?
3. **Cor de marca:** proposta `#1D4ED8` (azul). A referência parece usar azul como cor primária (não verificado via computed style). Confirmar azul ou outra cor (ex.: laranja Amazon)?
4. **Modo claro/escuro:** manter só claro (estado atual efetivo) ou preparar tokens para escuro já neste redesenho?
5. **Dashboard do motorista:** remover o placeholder "Disponibilidade semanal — em breve" ou mantê-lo discreto até a fase de disponibilidades?
6. **Badge de versão no header** ("v1.0 - Sistema de Escala"): entra ou não?
7. **E2E:** aprova o investimento nos 5 cenários Playwright da seção 7 como parte das fatias 5-8, ou prefere seguir só com checklist manual por ora?

---

## Anexo A — Evidências (screenshots)

Capturados localmente (`next dev`, Playwright, desktop 1440×900 / mobile 390×844):

- `docs/ux-reference/current-landing-desktop.png` / `-mobile.png`
- `docs/ux-reference/current-login-desktop.png` / `-mobile.png`
- `docs/ux-reference/current-auth-error-desktop.png` / `-mobile.png`
- `docs/ux-reference/current-forbidden-desktop.png` / `-mobile.png`

Não capturados (requerem sessão OAuth Amazon real; proibido criar dados/autenticar nesta tarefa): `/onboarding`, `/dashboard`, `/dispatch`, `/behavior`, `/drivers`, `/cnh`, `/admin/users`. Análise dessas telas é por leitura de código (arquivo:linha citado no diagnóstico).

Referência externa: screenshots não capturados (navegador embutido indisponível nesta sessão); estrutura verificada via conteúdo servido das 7 páginas.
