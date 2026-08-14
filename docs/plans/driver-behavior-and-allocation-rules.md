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
  necessária uma ação administrativa para editar a CNH (funcionalidade ainda
  não implementada).
- A distribuição de vagas acontece **normalmente** para motoristas com CNH
  vencida.
- Durante a distribuição, exibe-se um **asterisco (`\*`)** ao lado do motorista
  para indicar que a CNH está vencida e precisa ser atualizada.
- Notificação por e-mail 30 dias antes do vencimento continua desejada. O
  serviço de e-mail ainda não foi definido; quando implementado, usar
  [Resend](https://resend.com) conforme preferência técnica do projeto.

## 6. E-mails da planilha = contas Amazon

Os e-mails importados da planilha de motoristas são, **exatamente**, as contas
Amazon dos motoristas. O e-mail é a chave de acesso ao sistema.

---

## Referências

- Decisões originais do usuário:
  `~/.verdent/workspace/749836002083913728/b2e31654-09ba-49bb-b2ea-5ceb631ef3c9/decisoes-usuario-2026-08-14.md`
- Algoritmo de distribuição: `docs/plans/distribution-algorithm.md`
