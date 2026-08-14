# Especificação do Algoritmo de Distribuição de Vagas

## 1. Objetivos e Restrições do Algoritmo

### Objetivos

- Distribuir automaticamente as vagas publicadas (`VacancyProgram`) entre os motoristas disponíveis (`WeeklyAvailability`) da operação Amazon DSP.
- Respeitar disponibilidade, restrições de veículo, preferência de região/cidade, scorecard de performance, favoritos e penalidades comportamentais.
- Equilibrar a carga semanal entre motoristas e impedir mais de **6 dias consecutivos trabalhados** (incluindo a semana anterior).
- Produzir a escala preliminar (`Schedule`) com os status: `SIM`, `SEM_ESCALA`, `A_CONFIRMAR`, `NAO`, `SPEED`, `FALTA`.

### Restrições duras (hard constraints)

- Semana operacional: **Domingo a Sábado** (`DOMINGO`..`SABADO`).
- Apenas dias com `answer = SIM` ou `CICLO_2` (no ciclo correspondente) podem ser alocados, salvo *override* manual justificado.
- Máximo de **6 dias consecutivos trabalhados**; o 7º dia deve ser marcado como `SEM_ESCALA`.
- Motoristas com **3 dias ou menos** de disponibilidade não recebem vagas automaticamente; seus dias disponíveis ficam `A_CONFIRMAR`.
- Compatibilidade de veículo/restricão e de região/cidade.
- Apenas uma alocação por motorista por dia (não é permitido ocupar duas vagas no mesmo dia).

### Restrições flexíveis (soft constraints)

- Cota semanal ajustada por favorito, scorecard e penalidades.
- Preferência por preencher vagas especializadas (GNV, refrigerador, capacidade reduzida, Passeio) com motoristas que possuem a qualificação.
- Equilíbrio de carga: penalizar motoristas já muito alocados na semana para evitar concentração excessiva.

---

## 2. Entradas e Saídas (nomes do schema Prisma)

### Entradas

| Entidade | Função no algoritmo |
|---|---|
| `AvailabilityWeek` | Semana-alvo (`weekKey`, `year`, `weekNumber`) e janela de coleta. |
| `WeeklyAvailability` | Respostas de disponibilidade por motorista, dia e ciclo (`SIM`, `NAO`, `CICLO_2`). |
| `VacancyProgram` | Vagas publicadas por região, dia, ciclo e categoria de veículo (`quantity`). |
| `DriverProfile` | Atributos do motorista: `vehicleType`, `transporterId`, restrições e preferências. |
| `VehicleRestriction` | Restrições/capacidades (`GNV` [canonical], `REFRIGERADOR`, `CAPACIDADE_REDUZIDA`). `NATURAL_GAS` is a legacy duplicate of `GNV` retained for historical data only. |
| `RegionCityPreference` | Preferência de região/cidade/base do motorista. |
| `DriverScore` | Scorecard importado: `classification`, `dnrDpmo`, `dcr`, `contactCompliance`, `scanCompliance`, etc. |
| `FavoriteDriver` | Flag de favorito da semana (`isFavorite`, `source`). |
| `BehaviorRecord` | Penalidades comportamentais vigentes na semana (`severity`, `effectiveFromWeek`, `effectiveToWeek`). |
| `Schedule` (semana anterior) | Últimos status `SIM`/`SPEED` para cálculo de dias consecutivos entre semanas. |
| `AllocationRun` | Registro de execução do algoritmo (`triggerType`, `configSnapshot`). |

### Saídas

| Entidade | Função |
|---|---|
| `DistributionResult` | Candidatos gerados com `score`, flags de match e flag `assigned`. |
| `Schedule` | Células finais/preliminares da escala (`status`, `vehicleCategory`, `overrideById`, etc.). |
| `AllocationRun` | Execução atualizada para `COMPLETED` com `configSnapshot` e métricas. |
| `AuditLog` | Registro imutável da execução (`ALLOCATION_RUN`) e de eventuais ajustes manuais. |

---

## 3. Pseudocódigo por Fases

### 3.1 Pré-processamento

```text
FUNCTION AllocateWeek(weekKey, regionId = null):
    1. Criar AllocationRun com status RUNNING e configSnapshot padrão dos pesos.
    2. Carregar AvailabilityWeek por weekKey.
    3. Carregar todas WeeklyAvailability da semana (filtrar por regionId se fornecido via vagas).
    4. Carregar VacancyProgram com status PUBLICADA da semana.
    5. Carregar DriverProfile, VehicleRestriction, RegionCityPreference em memória.
    6. Carregar DriverScore mais recente por motorista (mesma semana ou último importado).
    7. Carregar FavoriteDriver para a semana.
    8. Carregar BehaviorRecord onde effectiveFromWeek <= weekKey <= effectiveToWeek.
    9. Carregar Schedule da semana anterior (weekNumber - 1) com status SIM/SPEED.
    10. Calcular, para cada motorista, consecutiveDaysBefore:
        - percorrer de SÁBADO para trás na semana anterior;
        - contar quantos dias consecutivos SIM/SPEED existem até o primeiro descanso.
    11. Montar matriz availability[driver][day][cycle] = SIM | CICLO_2 | NAO.
    12. Calcular availabilityDays[driver] = contagem de dias com resposta != NAO.
```

### 3.2 Cálculo da Cota Semanal Ajustada

```text
FUNCTION ComputeAdjustedQuota(driver):
    totalVacancySlots = SOMA(VacancyProgram.quantity) para a semana
    totalAvailabilityDays = SOMA(availabilityDays de todos os motoristas)

    IF availabilityDays[driver] <= 3:
        quota = 0
        lowAvailability = true
    ELSE:
        baseQuota = ARREDONDAR(totalVacancySlots * availabilityDays[driver] / totalAvailabilityDays)
        quota = baseQuota
        lowAvailability = false

    // Favorito
    IF FavoriteDriver.isFavorite para o motorista na semana:
        quota += 1

    // Ajuste de performance (scorecard classification + DNR DPMO)
    classification = DriverScore.classification
    dnr = DriverScore.dnrDpmo

    IF classification IN (FANTASTIC_PLUS, FANTASTIC, GREAT) AND dnr == 0:
        quota += 1
    ELSE IF (classification == GREAT AND dnr > 0) OR (classification == FAIR AND dnr == 0):
        quota += 0
    ELSE IF classification IN (FAIR, POOR) AND dnr > 0:
        quota -= 1

    // Penalidades comportamentais
    FOR EACH BehaviorRecord vigente:
        IF tipo == "Problema leve":
            quota -= 1
        ELSE IF tipo IN ("Reclamação insistente", "Falta grave"):
            quota -= 1  // vigente por até 2 semanas conforme effectiveToWeek
        ELSE IF tipo == "Problema grave (abandono de rota)":
            quota = 0
            removeAllVacancies = true

    quota = MAX(0, quota)
    RETURN (quota, lowAvailability, removeAllVacancies)
```

> **Nota sobre DNR DPMO == 0:** na implementação usar tolerância de ponto flutuante (ex.: `abs(dnr) < 1e-6`) por causa de parsing de PDF/planilha.

### 3.3 Fase de Atribuição

```text
FUNCTION AssignVacancies():
    Inicializar assignedDays[driver] = 0
    Inicializar schedule[driver][day] = vazio

    // Ordem de preenchimento: domingo → sábado; por região; ciclo CICLO_1, depois CICLO_2, depois SPEED
    FOR day IN [DOMINGO, SEGUNDA, TERCA, QUARTA, QUINTA, SEXTA, SABADO]:
        FOR EACH region em ordem de preferência:
            FOR EACH cycle IN [CICLO_1, CICLO_2, SPEED]:
                FOR EACH vehicleCategory em ordem (especializadas primeiro):
                    vagas = VacancyProgram.quantity para (day, region, cycle, vehicleCategory)

                    REPEAT vagas vezes:
                        candidates = []
                        FOR EACH driver:
                            IF removeAllVacancies[driver] == true: CONTINUE
                            IF availability[driver][day][cycle] == NAO: CONTINUE
                            IF driver já alocado em schedule[driver][day]: CONTINUE
                            IF AssigningWouldExceed6ConsecutiveDays(driver, day): CONTINUE
                            IF NOT VehicleCompatible(driver, vehicleCategory): CONTINUE

                            score = ComputeCandidateScore(driver, region, vehicleCategory)
                            candidates.APPEND({driver, score})

                        IF candidates está vazio:
                            vaga permanece não preenchida (será sinalizada na UI)
                        ELSE:
                            melhor = melhor candidato por score + tie-breakers
                            schedule[melhor.driver][day] = {region, cycle, vehicleCategory, status: SIM}
                            assignedDays[melhor.driver] += 1
                            ESCREVER DistributionResult(assigned=true)

    RETURN schedule
```

**`VehicleCompatible(driver, vehicleCategory)`:**
- Se categoria contém "Passenger" / "Passeio": `DriverProfile.vehicleType == PASSEIO`.
- Se categoria contém "Natural Gas" / "GNV": driver deve ter `VehicleRestriction` `GNV` (canonical). `NATURAL_GAS` is a legacy duplicate checked only for backward compatibility with historical data.
- Se categoria contém "Refrigerado" / "Fridge": driver deve ter `REFRIGERADOR`.
- Se categoria contém capacidade reduzida: driver deve ter `CAPACIDADE_REDUZIDA`.
- Demais categorias: qualquer motorista `CARGO_VAN` ou `PASSEIO` conforme normalização.

**`AssigningWouldExceed6ConsecutiveDays(driver, day)`:**
- Calcular dias consecutivos já trabalhados imediatamente antes do `day` considerando a semana atual + `consecutiveDaysBefore`.
- Se atingir 6 dias consecutivos antes de `day`, marcar `SEM_ESCALA` em vez de alocar.
- Se a alocação em `day` criaria o 7º dia consecutivo, proibir.

### 3.4 Pós-processamento

```text
FUNCTION PostProcessSchedule():
    FOR EACH driver:
        FOR day IN [DOMINGO..SABADO]:
            IF schedule[driver][day] existe:
                status = SIM
                ESCREVER Schedule(status=SIM, region, cycle, vehicleCategory)
            ELSE IF AssigningWouldExceed6ConsecutiveDays(driver, day):
                ESCREVER Schedule(status=SEM_ESCALA)
            ELSE IF availability[driver][day][CICLO_1] == SIM OR availability[driver][day][CICLO_2] == CICLO_2:
                // Disponível mas não alocado
                IF lowAvailability[driver]:
                    ESCREVER Schedule(status=A_CONFIRMAR, motivo="≤3 dias de disponibilidade")
                ELSE:
                    ESCREVER Schedule(status=A_CONFIRMAR, motivo="vagas insuficientes")
            ELSE:
                ESCREVER Schedule(status=NAO)

    // SPEED: aplicar somente se houver vagas de ciclo SPEED ou override manual
    // FALTA: preenchido manualmente pelo supervisor no dia da operação

    Atualizar AllocationRun para COMPLETED.
```

---

## 4. Fórmula de Pontuação e Critérios de Desempate

### Fórmula proposta

Os pesos abaixo são configuráveis via `AllocationRun.configSnapshot`:

```text
score = classificationScore
      + favoriteBonus
      + dnrZeroBonus
      + regionMatchBonus
      + vehicleMatchBonus
      - behaviorPenalty
      - loadBalancePenalty
      + quotaUrgencyBonus
```

| Componente | Valor | Origem |
|---|---|---|
| `classificationScore` | FANTASTIC_PLUS=100, FANTASTIC=80, GREAT=60, FAIR=40, POOR=20 | `DriverScore.classification` |
| `favoriteBonus` | +15 | `FavoriteDriver.isFavorite == true` |
| `dnrZeroBonus` | +10 | `DriverScore.dnrDpmo == 0` |
| `regionMatchBonus` | +8 | `RegionCityPreference.regionId == VacancyProgram.regionId` |
| `vehicleMatchBonus` | +5 | categoria exata ou `vehicleType` bate |
| `behaviorPenalty` | severity * 10 (ex.: leve=10, grave=30) | `BehaviorRecord.impactScore` ou `severity` |
| `loadBalancePenalty` | assignedDays * 2 | quantidade de vagas já atribuídas na semana |
| `quotaUrgencyBonus` | +5 se assignedDays < adjustedQuota | incentiva atingir a cota |

### Critérios de desempate

1. `classification` melhor (`FANTASTIC_PLUS` → `POOR`).
2. `dcr` maior.
3. `dnrDpmo` menor.
4. `contactCompliance` maior.
5. `scanCompliance` maior.
6. Menor número de dias já atribuídos na semana (`assignedDays`).
7. Timestamp de submissão da disponibilidade mais antigo (`WeeklyAvailability.submittedAt`).
8. Ordem alfabética do nome como fallback determinístico.

---

## 5. Exemplo Trabalhado com Dados Reais do CSV

Amostra das primeiras 10 linhas de `DA_Disponibilidade_Form.csv` (colunas Domingo a Sábado + Ciclo 2 - Tarde):

| # | Motorista | Dom | Seg | Ter | Qua | Qui | Sex | Sáb | Ciclo 2 | Disponibilidade |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Alan Gilsemberg | Não | Sim | Sim | Sim | Sim | Sim | Não | Não | 5 |
| 2 | Alexandre Lima | Não | Sim | Sim | Sim | Sim | Sim | Não | Não | 5 |
| 3 | Alexandro Torres | Sim | Sim | Sim | Sim | Sim | Sim | Sim | Sim | 8 |
| 4 | Anderson Silva Costa | Não | Sim | Sim | Sim | Sim | Sim | Sim | Sim | 7 |
| 5 | Andrea de Jesus Moura | Sim | Sim | Sim | Não | Sim | Sim | Não | Não | 4 |
| 6 | Antônio Carlos Leopoldino | Não | Sim | Sim | Não | Não | Não | Não | Não | 2 |
| 7 | Antonio Delphino Alves Jr | Sim | Sim | Sim | Sim | Sim | Sim | Sim | Não | 7 |
| 8 | Bruno Bianchi Gomes | Não | Sim | Sim | Não | Sim | Sim | Não | Sim | 5 |
| 9 | Bruno de Souza Domiciano | Sim | Sim | Sim | Sim | Sim | Sim | Sim | Sim | 8 |
| 10 | Claudinei Dias | Não | Sim | Sim | Sim | Sim | Sim | Não | Não | 5 |

### Hipóteses do exemplo

- Região: `XSP7`, ciclo: `CICLO_1`, categoria: `Small R2.0 BR`.
- Vagas por dia: Domingo=2, Segunda=4, Terça=4, Quarta=4, Quinta=4, Sexta=4, Sábado=2 (**total=24**).
- Scorecard hipotético:
  - Alan: FANTASTIC, dnrDpmo=0, favorito.
  - Alexandre: GREAT, dnrDpmo=0.
  - Alexandro: GREAT, dnrDpmo=150.
  - Anderson: FAIR, dnrDpmo=80.
  - Andrea: FAIR, dnrDpmo=0.
  - Antônio Carlos: POOR, dnrDpmo=200.
  - Antonio Delphino: GREAT, dnrDpmo=0.
  - Bruno Bianchi: FAIR, dnrDpmo=50, com **Problema leve** (penalidade -1 vaga).
  - Bruno de Souza: GREAT, dnrDpmo=0.
  - Claudinei: FANTASTIC, dnrDpmo=0, favorito.
- Sem escala publicada na semana anterior (todos começam com 0 dias consecutivos).

### Cotas ajustadas

Total de dias disponíveis = 5+5+8+7+4+2+7+5+8+5 = **56**.

| # | Motorista | Base | Favorito | Performance | Penalidade | **Cota Final** |
|---|---|---|---|---|---|---|
| 1 | Alan | round(24×5/56)=2 | +1 | +1 (Fantastic, DNR=0) | — | **4** |
| 2 | Alexandre | 2 | — | +1 (Great, DNR=0) | — | **3** |
| 3 | Alexandro | round(24×8/56)=3 | — | 0 (Great, DNR>0) | — | **3** |
| 4 | Anderson | round(24×7/56)=3 | — | -1 (Fair, DNR>0) | — | **2** |
| 5 | Andrea | round(24×4/56)=2 | — | 0 (Fair, DNR=0) | — | **2** |
| 6 | Antônio Carlos | round(24×2/56)=1 | — | -1 (Poor, DNR>0) | — | **0** (≤3 dias → A_CONFIRMAR) |
| 7 | Antonio Delphino | 3 | — | +1 (Great, DNR=0) | — | **4** |
| 8 | Bruno Bianchi | 2 | — | 0 (Fair, DNR>0) | -1 (Problema leve) | **0** |
| 9 | Bruno de Souza | 3 | — | +1 (Great, DNR=0) | — | **4** |
| 10 | Claudinei | 2 | +1 | +1 (Fantastic, DNR=0) | — | **4** |

### Atribuição preliminar

Considerando os scores e a cota, uma distribuição possível é:

| Dia | Motoristas alocados (SIM) |
|---|---|
| Domingo | Alexandro, Bruno de Souza |
| Segunda | Alan, Alexandre, Antonio Delphino, Claudinei |
| Terça | Alan, Alexandre, Andrea, Bruno de Souza |
| Quarta | Alan, Antonio Delphino, Claudinei, Bruno de Souza |
| Quinta | Alexandre, Antonio Delphino, Claudinei, Bruno de Souza |
| Sexta | Alan, Alexandro, Andrea, Anderson |
| Sábado | Alexandro, Anderson |

### Escala final preliminar (status por motorista)

| # | Motorista | Dom | Seg | Ter | Qua | Qui | Sex | Sáb | Observação |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Alan | Não | Sim | Sim | Sim | Não | Sim | Não | 4 vagas atingidas |
| 2 | Alexandre | Não | Sim | Sim | Não | Sim | Não | Não | 3 vagas atingidas |
| 3 | Alexandro | Sim | Não | Não | Não | Não | Sim | Sim | 3 vagas atingidas |
| 4 | Anderson | Não | Não | Não | Não | Não | Sim | Sim | 2 vagas atingidas |
| 5 | Andrea | à Confirmar | Não | Sim | Não | Não | Sim | Não | Dias disponíveis não alocados ficam à Confirmar |
| 6 | Antônio Carlos | Não | à Confirmar | à Confirmar | Não | Não | Não | Não | ≤3 dias → à Confirmar |
| 7 | Antonio Delphino | à Confirmar | Sim | Não | Sim | Sim | Não | Não | 3 vagas (cota 4) |
| 8 | Bruno Bianchi | Não | à Confirmar | à Confirmar | Não | à Confirmar | à Confirmar | Não | Cota zerada por penalidade |
| 9 | Bruno de Souza | Sim | Não | Sim | Sim | Sim | Não | Não | 4 vagas atingidas |
| 10 | Claudinei | Não | Sim | Não | Sim | Sim | Não | Não | 3 vagas (cota 4) |

> O exemplo é ilustrativo. A ordem exata de escolha pode variar conforme os tie-breakers e a política de pesos, mas a lógica de quotas, penalidades e restrições permanece a mesma.

---

## 6. Casos Especiais (Edge Cases)

| Caso | Comportamento do algoritmo |
|---|---|
| **Mais vagas que motoristas disponíveis** | As vagas excedentes permanecem não preenchidas. A UI deve destacar dias com vagas sobrando para possível ajuste manual ou publicação de vagas extras. |
| **Menos vagas que motoristas disponíveis** | Motoristas elegíveis não alocados ficam `A_CONFIRMAR`. Motoristas com ≤3 dias também ficam `A_CONFIRMAR`. |
| **Cruzamento de semanas (6 dias consecutivos)** | Usa `Schedule` da semana anterior para calcular `consecutiveDaysBefore`. Impede alocação que criaria o 7º dia; marca como `SEM_ESCALA`. |
| **Múltiplas regiões por transportadora** | Cada `VacancyProgram` pertence a uma `Region`. O algoritmo itera por região, mas impede que um motorista seja alocado em mais de uma região no mesmo dia. |
| **Overrides manuais e re-execução** | Re-execução cria novo `AllocationRun`. Células com `overrideById` e justificativa podem ser preservadas ou resetadas conforme escolha do supervisor. Células `isLocked=true` (após envio WhatsApp) nunca são sobrescritas automaticamente. |
| **Empate de score** | Aplicar os desempates na ordem definida; se persistir, usar ordem alfabética do nome como fallback determinístico. |

---

## 7. Análise de Complexidade

- Seja **D** = número de motoristas (esperado ≤ 100).
- Seja **V** = total de vagas na semana (quantidade × dias × regiões × categorias, esperado ≤ 500).
- Seja **C** = número de ciclos (3: CICLO_1, CICLO_2, SPEED).

| Fase | Complexidade |
|---|---|
| Pré-processamento (carga de entidades) | O(D + V) |
| Cálculo de cota | O(D) |
| Atribuição (por vaga, avalia todos os motoristas) | O(V × D) |
| Pós-processamento / geração de Schedule | O(D × 7) = O(D) |
| **Total** | **O(V × D)** |

Com os volumes típicos da operação XSP7, a execução fica bem abaixo de 1 segundo em hardware modesto. A memória adicional é O(D × 7 + V).

---

## 8. Regras de Validação para Edições Manuais

1. **Disponibilidade:** não permitir `SIM`/`SPEED` em dia com `answer=NAO`, salvo *override* com justificativa.
2. **Dias consecutivos:** recalcular sequência incluindo semana anterior; recusar alteração que crie 7+ dias consecutivos.
3. **Compatibilidade de veículo:** recusar alocação em categoria especializada sem a restrição correspondente.
4. **Uma alocação por dia:** impedir duas células `SIM`/`SPEED` no mesmo dia para o mesmo motorista.
5. **Células bloqueadas:** `isLocked=true` não podem ser editadas sem desbloqueio justificado.
6. **Auditoria:** toda alteração manual grava `AuditLog` com `eventType=SCHEDULE_UPDATED` ou `MANUAL_OVERRIDE`, actor, oldValue, newValue e justificativa.
7. **Validação em lote:** ao publicar, o sistema deve verificar se todas as vagas obrigatórias estão preenchidas ou explicitamente sinalizadas como não preenchidas.

---

## 9. Perguntas em Aberto e Suposições

### Perguntas em aberto

1. `Ciclo 1` vs `Ciclo 2` vs `Speed`: `CICLO_2` e `SPEED` são modelados separadamente no schema, mas ainda não está claro se representam o mesmo conceito ou pools separados.
2. Critério exato de favorito: a regra padrão adotada é Fantastic Plus/Fantastic, mas o Gerente de Contas pode fazer override manual via `FavoriteDriver.source=MANUAL`.
3. Regra exata do status `SPEED`: trata-se como turno extra/especial, preenchido após `CICLO_1`/`CICLO_2` ou por vagas específicas `VacancyProgram.cycle=SPEED`.
4. Peso das penalidades comportamentais: a proposta usa `severity * 10`, mas pode ser ajustada conforme política interna.
5. Região/cidade: a correspondência atual exige `RegionCityPreference.regionId == VacancyProgram.regionId`; pode ser relaxada para cidade quando houver mapeamento oficial.
6. Garantia da cota: a cota ajustada é um direcionamento (soft constraint) e não uma garantia absoluta, pois a disponibilidade diária e as restrições de veículo podem impedir o atingimento.

### Suposições registradas

- `A-DIST-01`: Semana operacional começa no domingo e termina no sábado, conforme `WeekDay`.
- `A-DIST-02`: DNR DPMO igual a zero usa tolerância de ponto flutuante (`abs(dnr) < 1e-6`).
- `A-DIST-03`: Motorista alocado em `CICLO_2` só pode ocupar vagas `VacancyProgram.cycle=CICLO_2`.
- `A-DIST-04`: A reexecução do algoritmo não sobrescreve células `isLocked=true`.
- `A-DIST-05`: Penalidade por “abandono de rota” zera todas as vagas da semana (`removeAllVacancies=true`).

---

## Rastreabilidade Requisitos → Especificação

| Requisito/Fonte | Local no documento |
|---|---|
| RF-015 a RF-018 (algoritmo e reexecução) | Seções 1, 3.3, 6 |
| RN-001 a RN-006 (semana e 6 dias consecutivos) | Seções 1, 3.1, 3.3, 6 |
| RN-007/RN-008 (≤3 dias → à Confirmar) | Seções 3.2, 3.4, 5 |
| RN-009/RN-010 (favoritos) | Seções 3.2, 4 |
| RN-011 a RN-015 (scorecard) | Seções 3.2, 4 |
| RN-016/RN-017 (veículo) | Seções 3.3, 8 |
| Schema Prisma (`VacancyProgram`, `DistributionResult`, `Schedule`, etc.) | Seções 2, 3, 4 |
| Exemplo CSV `DA_Disponibilidade_Form.csv` | Seção 5 |
