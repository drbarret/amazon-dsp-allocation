# Regras de distribuição e comportamento dos motoristas

> Especificação autoritativa copiada das decisões do usuário em
> `2026-08-14`. Leia este documento antes de implementar qualquer lógica de
> distribuição de vagas, cadastro/edição de motoristas ou modelo de comportamento.

---

## 1. Cidades de preferência

- O motorista **preenche as cidades de preferência no cadastro inicial**.
- Depois do cadastro, **somente supervisores** podem alterar essa lista.
- As cidades são **preferência, não garantia**: o motorista pode ser alocado em
  outra cidade. Essa regra deve ficar **explícita na interface** no momento da
  escolha.
- **O algoritmo de distribuição NÃO usa cidade nesta fase.** O dado é coletado
  para uso futuro, mas não deve ser usado como peso ou desempate agora.
- Implicação: é necessária uma ação administrativa para que o supervisor edite
  as cidades de um motorista (funcionalidade ainda não implementada).

## 2. Tipo de veículo como categoria própria

Cargo Van, Large Van e Passenger (carro de passeio) são **categorias próprias**.
Uma vaga só pode ser preenchida por um motorista cujo veículo seja
**compatível com a categoria daquela vaga**. Não existe fallback genérico.

| Categoria da vaga | Veículos compatíveis |
| ----------------- | -------------------- |
| Cargo Van         | Cargo Van            |
| Large Van         | Large Van            |
| Passenger         | Passenger            |

> Impacta o algoritmo de distribuição (Fase 2). A implementação anterior de
> `VehicleCompatible()` tratava `LARGE_VAN` como compatível com qualquer
> motorista `CARGO_VAN` ou `PASSENGER`; essa lógica contradiz esta regra e
> deve ser corrigida.

## 3. Modelo de comportamento

A regra anterior "3 marcações = desativação automática do perfil" **não é
automática**. Comportamento é subjetivo e deve ser marcado pontualmente pelo
supervisor.

### 3.1 Tipos de infração

| # | Problema real | Natureza |
| - | ------------- | -------- |
| 1 | Não reverter insucessos no fim da rota, mesmo terminando cedo. | Objetivo |
| 2 | Reclamar da quantidade de paradas de forma áspera, incomodando supervisores. | Subjetivo |
| 3 | Faltas recorrentes sem justificativa. | Objetivo |
| 4 | Deixar a rota no chão durante o dispatch por achar a rota grande. | Objetivo, **grave** |
| 5 | Não cumprir as regras da Amazon. | Misto |

### 3.2 Aprovação do gerente para reclamação áspera

A marcação do item 2 (reclamação áspera) exige **aprovação de um gerente**.

### 3.3 Ciclo de punição e zeramento

1. Após uma marcação válida, a punição é aplicada **na semana seguinte**, de
   forma automática.
2. Existem duas formas de punição:
   - **Perda de 1 vaga** (casos comuns).
   - **1 semana sem vagas** (caso grave — item 4).
3. A punição **só é considerada cumprida quando o motorista efetivamente perde
   1 vaga** na distribuição. Ela não caduca sozinha com a passagem da semana;
   se o motorista não receber vaga naquela semana, a punição continua pendente
   até ser cumprida.
4. **Cumprida a punição, o sistema zera automaticamente** e o motorista volta a
   competir em igualdade com os demais.

### 3.4 Reincidência

Na próxima infração, a punição **dobra**:

- 2 vagas de perda (caso comum).
- 2 semanas sem vagas (caso grave).

Na reincidência, o supervisor é avisado para **desativar** o motorista. Se o
supervisor não desativar, os **gerentes de conta** são avisados e podem
efetuar a desativação.

### 3.5 Quem pode desativar ou reativar

| Ação | Quem pode executar |
| ---- | ------------------ |
| Desativar por reincidência de comportamento | Supervisor ou gerente de conta |
| Desativar após supervisor não agir | Gerente de conta |
| Reativar motorista desativado por gerente de conta | **Somente** gerente de conta |
| Reativar motorista desativado por supervisor | Supervisor (exceto se posteriormente confirmado por gerente de conta) |

## 4. Garantia mínima de vagas

Objetivo operacional: **ao menos 3 vagas por semana por motorista**.

Essa regra existe para evitar que prestadores de serviço desistam por falta de
trabalho e deve proteger os motoristas em bom standing, que são a maioria.

## 5. CNH vencida

- Motorista com CNH vencida **não é bloqueado** no sistema.
- O supervisor pode atualizar a data da CNH **a qualquer momento** — é
  necessária uma ação administrativa para editar a CNH.
- A distribuição de vagas acontece **normalmente** para motoristas com CNH
  vencida.
- Durante a distribuição, exibe-se um **asterisco (`\*`)** ao lado do motorista
  para indicar que a CNH está vencida e precisa ser atualizada.
- **A cobrança de CNH é MANUAL, feita pelo supervisor** (decisão 2026-08-15).
  Não existe disparo automático, agendamento ou janela de vencimento. O
  supervisor identifica os motoristas com CNH vencida, marca quem vai receber
  e clica em **"Cobrar CNH atualizada"**. O envio usa
  [Resend](https://resend.com). O disparo automático (endpoint de cron e
  script) foi **removido**.

## 6. E-mails da planilha = contas Amazon

Os e-mails importados da planilha de motoristas são, **exatamente**, as contas
Amazon dos motoristas. O e-mail é a chave de acesso ao sistema.

---

## 7. Decisões confirmadas em 2026-08-15

> Atualização autoritativa. Itens A–F abaixo fecham decisões que estavam
> abertas. Nenhum número novo foi inventado; tudo foi confirmado pelo usuário.

### A. Teto de vagas por motorista: NÃO EXISTE

O sistema tenta distribuir **ao menos 3 vagas por motorista** no ciclo 1, mas
semanas em que nem todos alcançam o mínimo de 3 são **aceitáveis e esperadas**.
Isso **não é um bug**: o algoritmo de distribuição já se comporta assim e não
deve ser alterado. Quem vir "motorista com menos de 3 vagas" não deve tratar
como falha.

### B. Janela de reincidência: 4 semanas, depois zera

A janela de reincidência é de **4 semanas** (`RECIDIVISM_WINDOW_WEEKS = 4` em
`src/lib/behavior.ts`). Uma nova marcação conta como reincidência se houver
punição **ativa** ou se a última punição cumprida estiver **dentro de 4 semanas**
(`isRecidivismMark` compara `now - lastFulfilledAt <= 4 * 7 dias`). Depois de 4
semanas, o contador **zera** e o motorista volta a competir em igualdade. O
código já implementa exatamente isso — apenas documentado aqui.

### C. Escalonamento supervisor → gerente de conta: gatilho por CICLO

O gatilho de escalonamento **deixou de ser tempo em dias** e passou a ser
**evento de ciclo de distribuição**:

> Se chegar o próximo ciclo de distribuição e o supervisor não decidiu, sobe.

- **Momento exato do disparo:** dentro de `runDistribution`
  (`src/app/(protected)/dispatch/actions.ts`), após a distribuição e a
  resolução de punições do ciclo. Quando um novo ciclo roda, toda infração de
  reincidência ainda **pendente de decisão do supervisor** é escalada aos
  gerentes de conta.
- **O que é "pendente de decisão":** a infração tem `supervisorNotifiedAt`
  preenchido (aviso de reincidência enviado), ainda **não** foi escalada
  (`escalatedAt` nulo), não está `CANCELLED`, e o motorista **continua ativo**
  (o supervisor não o desativou — desativar é a decisão que o aviso pede).
- **Idempotência:** ao escalar, o sistema grava `escalatedAt`. Rodar a
  distribuição duas vezes no mesmo ciclo, ou em ciclos seguintes, **nunca**
  escala a mesma infração duas vezes.
- O prazo fixo de 7 dias (`ESCALATION_DAYS`) e a função `isEscalationDue`
  foram **removidos** — não fazem mais sentido e não devem coexistir com o
  gatilho por ciclo. A ação manual `escalateRecidivism` permanece apenas como
  fallback para o gerente de conta.

### D. Remetente de e-mail

- Domínio: `instalog.com.br`.
- Endereço remetente: `trc-brasil@instalog.com.br` (TRC = Transportation Risk
  and Compliance).
- O fallback fixo em `src/lib/email.ts` foi atualizado para esse endereço
  (antes apontava para um domínio da Vercel que o Resend não aceitaria).
- O domínio precisa estar **verificado na conta do Resend** para o envio
  funcionar. Nenhuma chave de API é commitada.

### E. CRLV e cadastro de veículo: FASE 2 (fora do escopo atual)

Planejado para a segunda fase — **não implementado nesta tarefa**:

- Campos: **PLACA, ANO DE FABRICAÇÃO, ANO MODELO, EXERCÍCIO, CHASSI**.
- Critério de aceitação do veículo: **idade máxima de 15 anos**.
- O motorista envia o documento no onboarding.
- Avisos por e-mail previstos: CRLV vencido, CRLV pendente de licenciamento,
  ano do veículo fora do critério.

### F. Pendência operacional: tipo de veículo

A importação gravou `vehicleType = CARGO_VAN` fixo para todos, então os 83
motoristas ativos estão **todos na mesma categoria**. A regra de categoria
estrita do algoritmo está correta, mas fica **inócua** até os tipos reais serem
cadastrados. A tela de edição pelo supervisor virá em tarefa separada.

### G. Cobrança de CNH é manual (supervisor)

O e-mail de CNH **não é mais automático** (decisão 2026-08-15). Nada de janela
de 30 dias, agendamento ou rotina que dispara sozinha. O envio é um ato
deliberado do supervisor, com seleção explícita de quem recebe:

- O supervisor acessa a tela de cobrança de CNH, vê os motoristas **ativos**
  com **CNH vencida** (com a data de vencimento e a **última cobrança** de
  cada um), marca quem vai receber e clica em **"Cobrar CNH atualizada"**.
- O servidor **revalida** cada selecionado (papel DRIVER, ativo e CNH vencida)
  antes de enviar — a seleção vinda do cliente nunca é confiada.
- **Reenvio é permitido**: cada cobrança é registrada como histórico com
  data/hora e autor. A restrição de unicidade em `cnh_reminders` foi removida
  (migração `20260815190000_cnh_collection_history`).
- O disparo automático foi **removido**: endpoint `POST /api/cron/cnh-reminders`
  e script `scripts/send-cnh-reminders.mjs` foram apagados, e `CRON_SECRET`
  deixou de ser necessária.
- Auditoria: cada cobrança registra `CNH_COLLECTED` com autor e contagem de
  destinatários (sem PII em log).

---

## Referências

- Decisões originais do usuário:
  `~/.verdent/workspace/749836002083913728/b2e31654-09ba-49bb-b2ea-5ceb631ef3c9/decisoes-usuario-2026-08-14.md`
- Algoritmo de distribuição: `docs/plans/distribution-algorithm.md`
