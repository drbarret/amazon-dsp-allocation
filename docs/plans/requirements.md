# Requisitos - Amazon DSP Driver Allocation System

## 1. Visão Geral

Sistema web/mobile para gerenciamento e alocação automática de motoristas de entrega (Delivery Associates - DAs) da operação Amazon DSP da ILLT no hub XSP7.

O sistema deve consolidar disponibilidade dos motoristas, publicar vagas aprovadas pela Amazon, distribuí-las automaticamente respeitando regras de negócio, permitir ajustes manuais e entregar a escala individual de cada motorista via WhatsApp Business.

> Baseado nos materiais de referência:
> - `BR_ILLT_XSP7_Week31_2026_DSPScorecard.pdf`
> - `ILLT_Planejamento_Rotas.xlsx` / `ILLT_Planejamento_Rotas.csv`
> - `DA_Disponibilidade_Form.csv`
> - Imagens de referência: `Escala_individual_WA.jpg`, `Escala_DA.jpg`, `Programacao_Semana33.jpg`, `Vagas _Apravadas_Amazon.png`

---

## 2. Stakeholders e Papéis de Usuário

| Papel | Responsabilidades | Acesso |
|-------|-------------------|--------|
| **Motorista (DA / Driver)** | Informar disponibilidade semanal; visualizar escala individual; confirmar leitura da escala | Somente próprios dados |
| **Supervisor de Operações** | Publicar vagas diárias; executar distribuição automática; ajustar escala manualmente; aprovar exceções; enviar escalas via WhatsApp | Todas as escalas, drivers e configurações operacionais |
| **Gerente de Contas** | Configurar regras de alocação; definir favoritos/penalidades; importar scorecard; auditar métricas e compliance | Administrativo completo, relatórios e integrações |

---

## 3. Requisitos Funcionais

### 3.1 Login e Cadastro de Motoristas (Amazon OAuth)

- **RF-001** O sistema deve permitir login via **Amazon OAuth** para motoristas e gestores, utilizando credenciais corporativas vinculadas à conta DSP.
- **RF-002** No primeiro acesso, o motorista deve completar o cadastro com:
  - Nome completo
  - CPF
  - E-mail
  - Telefone para WhatsApp Business
  - Tipo de veículo (Cargo Van / Passeio)
  - Restrições do veículo (kit gás/GNV, refrigerador, capacidade reduzida)
- **RF-003** O sistema deve associar cada motorista ao seu `Transporter ID` da Amazon.
- **RF-004** O login deve ser restrito a e-mails previamente cadastrados na lista de acesso (AllowedEmail com status ACTIVE). Não há auto-aprovação por domínio corporativo — toda identidade precisa ser explicitamente registrada.

### 3.2 Coleta Semanal de Disponibilidade

- **RF-005** O sistema deve abrir a coleta de disponibilidade sempre para a **próxima semana** (domingo a sábado), identificada no formato **WK-XX**.
- **RF-006** A janela de coleta deve ser de **Domingo 06h00 à Segunda-feira 15h00**.
- **RF-007** O gestor poderá prorrogar a janela em até **30 minutos** após o horário limite.
- **RF-008** O motorista deve informar disponibilidade para cada dia da semana (Dom, Seg, Ter, Qua, Qui, Sex, Sáb) com opções:
  - **Sim** — disponível
  - **Não** — indisponível
  - Ciclo 2 / Tarde (quando aplicável)
- **RF-009** O formulário deve bloquear edição após o fechamento da janela.
- **RF-010** O sistema deve permitir visualização consolidada de todas as disponibilidades coletadas.

### 3.3 Publicação de Vagas

- **RF-011** O Supervisor de Operações deve publicar as vagas diárias para a próxima semana, por categoria/região:
  - **Ciclo 1** (manhã)
  - **Ciclo 2** / Tarde
  - Categorias de veículo: Cargo Van (Small) R2.0 BR, Inside Natural Gas, Passenger, etc.
  - Regiões/hubs: XSP7, ELP7, DSP5
- **RF-012** As quantidades devem ser inseridas dia a dia (Domingo a Sábado).
- **RF-013** O sistema deve exibir totais por dia e por categoria, destacando divergências entre vagas aprovadas e motoristas disponíveis.
- **RF-014** O sistema deve importar vagas aprovadas pela Amazon quando disponível via arquivo ou integração.

### 3.4 Algoritmo Automático de Distribuição de Vagas

- **RF-015** O sistema deve executar um algoritmo que distribua as vagas publicadas entre os motoristas disponíveis.
- **RF-016** A distribuição deve considerar, em ordem de prioridade:
  1. Disponibilidade informada pelo motorista (`Sim`).
  2. Restrições de veículo e região/cidade.
  3. Score de performance (favoritos com melhor desempenho no scorecard).
  4. Penalidades comportamentais e histórico de faltas.
  5. Regras de descanso e dias consecutivos (máx. 6 dias).
  6. Equilíbrio de carga entre motoristas (evitar concentração excessiva).
- **RF-017** Após a execução do algoritmo, o sistema deve gerar a escala preliminar com os status:
  - **Sim** — motorista alocado na vaga.
  - **Sem Escala** — 7º dia consecutivo trabalhado ou limite de 6 dias atingido.
  - **à Confirmar** — motorista informou disponibilidade, mas não há vaga suficiente.
  - **Não** — motorista não informou disponibilidade.
  - **Speed** — alocação em turno extra/especial (definir regra específica).
  - **FALTA** — motorista faltou no dia (campo operacional).
- **RF-018** O Supervisor deve poder reexecutar o algoritmo enquanto a escala não estiver publicada.

### 3.5 Visualização Editável da Escala

- **RF-019** O sistema deve apresentar uma grade semanal (Domingo a Sábado) com todos os motoristas e seus status diários, similar à planilha `ILLT_Planejamento_Rotas.xlsx`.
- **RF-020** A grade deve permitir edição manual célula a célula pelo Supervisor, com validação das regras de negócio.
- **RF-021** O sistema deve bloquear alocações que violem:
  - Máximo de 6 dias consecutivos trabalhados.
  - Indisponibilidade declarada.
  - Capacidade do veículo incompatível com a vaga.
- **RF-022** Deve haver indicadores visuais para:
  - Dias com vagas não preenchidas.
  - Dias com excesso de motoristas alocados.
  - Motoristas com escala incompleta ou à confirmar.
- **RF-023** A grade deve exibir totais por dia, separados por categoria de veículo/ciclo (ex.: XSP7 - CV 8H, XSP7 - Passenger, ELP7, DSP5).

### 3.6 Geração de Escala Individual e Envio via WhatsApp Business

- **RF-024** O sistema deve gerar, para cada motorista, uma escala individual contendo:
  - Número da semana e intervalo de datas.
  - Nome do motorista.
  - Status de cada dia (Sim, Sem Escala, à Confirmar, Speed, etc.).
- **RF-025** O layout deve seguir o modelo da imagem `Escala_individual_WA.jpg`, com:
  - Cabeçalho azul/amarelo.
  - Rodapé informativo: "Escala conforme sua informação de disponibilidade." e "Após o envio da escala, não será permitido realizar trocas de dias entre motoristas."
- **RF-026** O sistema deve enviar a escala individual automaticamente para o WhatsApp do motorista via **WhatsApp Business API**.
- **RF-027** O envio deve ocorrer após a publicação final da escala pelo Supervisor.
- **RF-028** O sistema deve registrar confirmação de leitura/entrega quando possível.

---

## 4. Regras de Negócio

### 4.1 Ciclo da Semana

- **RN-001** A semana operacional vai de **Domingo a Sábado**.
- **RN-002** O sistema sempre trabalha com a **próxima semana** em relação à data atual.
- **RN-003** A semana deve ser identificada no formato **WK-XX**.

### 4.2 Limite de Dias Consecutivos

- **RN-004** Nenhum motorista pode trabalhar mais que **6 dias consecutivos**.
- **RN-005** O 7º dia consecutivo deve ser automaticamente marcado como **Sem Escala**, independentemente de disponibilidade.
- **RN-006** O algoritmo deve considerar a escala da semana anterior para evitar sequências que ultrapassem 6 dias entre semanas.

### 4.3 Motoristas com Baixa Disponibilidade

- **RN-007** Motoristas que informarem **3 dias ou menos** de disponibilidade devem ter seus dias não alocados marcados como **à Confirmar**.
- **RN-008** A confirmação desses dias depende de aprovação do Supervisor.

### 4.4 Favoritos e Performance

- **RN-009** Motoristas classificados como **Favoritos** (Fantastic Plus/Fantastic no scorecard) têm direito a **+1 turno semanal** em relação aos demais, respeitando sua disponibilidade.
- **RN-010** A classificação de favorito é baseada no scorecard Amazon DSP importado semanalmente.

### 4.5 Penalidades e Ajustes no Scorecard

- **RN-011** Faltas não justificadas (`FALTA`) registradas na escala impactam o score de performance do motorista.
- **RN-012** Motoristas com penalidades comportamentais perdem prioridade na distribuição automática.
- **RN-013** O sistema deve permitir ao Gerente de Contas aplicar flags de penalidade (ex.: advertência, suspensão temporária de alocação).
- **RN-014** O sistema deve importar métricas do scorecard para cálculo de prioridade:
  - DCR (Delivery Completion Rate)
  - DNR DPMO
  - Contact Compliance
  - Swipe to Finish Compliance
  - Work Hour Compliance (WHC)
  - Attrition
  - DSP Late Cancellation Rate
- **RN-015** A priorização deve considerar a classificação geral: Fantastic Plus > Fantastic > Great > Fair > Poor.

### 4.6 Restrições de Veículo

- **RN-016** Vagas para veículos com GNV/refrigerador/capacidade reduzida só podem ser preenchidas por motoristas que declararam tais restrições.
- **RN-017** Vagas de passeio só podem ser preenchidas por motoristas com veículo do tipo Passeio.

### 4.7 Bloqueio de Trocas

- **RN-018** Após o envio da escala via WhatsApp, **não será permitido realizar trocas de dias entre motoristas**, conforme mensagem padrão da escala individual.
- **RN-019** Ajustes após envio devem ser feitos apenas pelo Supervisor e requerem registro de justificativa.

---

## 5. Requisitos Não Funcionais

| ID | Requisito |
|----|-----------|
| **RNF-001** | **Segurança**: autenticação via Amazon OAuth; tokens com expiração; sessões seguras. |
| **RNF-002** | **Controle de acesso**: acesso limitado a e-mails previamente cadastrados na lista de acesso (AllowedEmail). |
| **RNF-003** | **Mobile-first**: interface otimizada para smartphones, uma vez que motoristas e supervisores acessam majoritariamente via celular. |
| **RNF-004** | **Idioma**: interface em português brasileiro (pt-BR). |
| **RNF-005** | **Disponibilidade**: 99,5% de uptime em horários críticos de coleta e publicação de escala. |
| **RNF-006** | **Auditoria**: log de todas as alterações manuais na escala (quem, quando, o quê, justificativa). |
| **RNF-007** | **LGPD**: consentimento para coleta de CPF e telefone; dados criptografados em repouso e em trânsito. |
| **RNF-008** | **Backup**: backup diário das escalas e configurações. |
| **RNF-009** | **Performance**: carregamento da grade semanal em até 3 segundos para até 100 motoristas. |
| **RNF-010** | **Notificações**: notificações por WhatsApp e/ou e-mail para lembretes de coleta e publicação de escala. |

---

## 6. Fontes de Dados e Integrações

### 6.1 Amazon OAuth
- Login dos motoristas e gestores.
- Sincronização do `Transporter ID` e dados básicos do perfil.

### 6.2 WhatsApp Business API
- Envio de escala individual para cada motorista.
- Possível uso para lembretes de coleta de disponibilidade.
- Registro de status de entrega/leitura.

### 6.3 Scorecard Amazon DSP
- Importação periódica do arquivo PDF/scorecard com métricas individuais.
- Dados esperados:
  - `da_rank`
  - `transporter_id`
  - `total_score`
  - `delivered`
  - `dcr`
  - `dnr_dpmo`
  - `contact_compliance`
  - `scan_compliance`
  - `wh_exception_flag`
  - `swa_ota`
  - Classificação final (Fantastic Plus, Fantastic, Great, Fair, Poor)

### 6.4 Planilha de Planejamento de Rotas
- Modelo para estrutura da grade semanal.
- Colunas: Motorista, Cidade, Veículo, Domingo a Sábado, Quantidade.
- Status: Sim, Não, Sem Escala, à Confirmar, Speed, FALTA, Passeio.

### 6.5 Formulário de Disponibilidade
- Modelo de entrada de dados do motorista.
- Campos: timestamp, e-mail, nome completo, CPF, restrições de veículo, disponibilidade domingo a sábado, Ciclo 2 - Tarde.

---

## 7. Perguntas em Aberto e Suposições

### Confirmações do Usuário (2026-08-10)

1. **Ciclo 2 / Tarde / Speed**: São a mesma coisa.
2. **Speed**: É um turno extra e também sinônimo de Ciclo 2/Tarde.
3. **Favoritos**: O Gerente de Contas marca manualmente. O favorito indica que o motorista é de confiança.
4. **Scorecard**: Somente em PDF.
5. **WhatsApp Business**: Conta Meta Verified já disponível.
6. **Regiões**: Criar funcionalidade para incluir novas regiões no futuro.
7. **Penalidades comportamentais**:
   - O Supervisor de Operações pode marcar comportamento do motorista.
   - O Gerente de Contas deve ser notificado e aprovar a marcação para aquela semana.
   - Aprovação retira vaga do motorista no planejamento da próxima semana.
   - Após aplicação, a marcação deve ser "resetada".
   - Se o motorista for marcado mais de 3 vezes, o perfil deve ser inativado e ele não poderá fazer login até reativação.
8. **Cota de favoritos**: O "+1 vaga semanal" é uma garantia.
9. **Troca de dias**: O Supervisor pode autorizar troca de dias a qualquer momento.
10. **Importação do scorecard**: Uma vez por semana, às quintas-feiras.

### Perguntas em Aberto

Nenhuma. Todas as confirmações pendentes foram resolvidas em 2026-08-10.

### Suposições

- **A1**: O sistema será acessado principalmente por navegador mobile, mas também deve funcionar em desktop.
- **A2**: A Amazon não fornecerá API direta para disponibilidade; a coleta será feita por formulário próprio.
- **A3**: O envio de WhatsApp será feito via WhatsApp Business API (conta Meta Verified já disponível).
- **A4**: O Supervisor de Operações tem autoridade para ajustar qualquer escala antes do envio final e autorizar trocas de dias a qualquer momento.
- **A5**: O formato WK-XX segue o calendário de semanas da Amazon (domingo é o primeiro dia da semana).
- **A6**: Motoristas com status `Não` não devem ser alocados, salvo exceção manual aprovada pelo Supervisor.
- **A7**: Ciclo 2/Tarde/Speed são equivalentes; motoristas disponíveis nesse ciclo podem ocupar vagas de Ciclo 2 e também podem receber turno extra (Speed).
- **A8**: Favoritos são definidos manualmente pelo Gerente de Contas e garantem +1 vaga semanal ao motorista.
- **A9**: Penalidades comportamentais exigem aprovação do Gerente de Contas e, uma vez aplicadas, são resetadas automaticamente após afetar o planejamento da semana seguinte.
- **A10**: Após 3 marcações comportamentais aprovadas, o perfil do motorista é inativado automaticamente e o login é bloqueado até reativação manual.

---

## 8. Histórico de Versões

| Versão | Data | Autor | Alterações |
|--------|------|-------|------------|
| 1.0 | 2026-08-07 | Verdent | Versão inicial consolidada a partir dos materiais de referência. |
| 1.1 | 2026-08-10 | Daniel Barreto / Verdent | Adicionadas confirmações do usuário para as 10 perguntas em aberto. |
