# Issue #1300 — protocolo de triagem independente do inventário

> Estado: **pendente de certificação**. Este documento não certifica candidatos, não altera a baseline imutável e não autoriza merge.

## Identidade e evidências obrigatórias

- Repositório: `crgasparoto-br/controle_calorias`.
- PR: #1324, base `develop`.
- Registrar em cada execução: SHA integral da PR, SHA da baseline arquitetural, nome e digest SHA-256 do artefato `food-architecture-inventory-<SHA>`, data UTC, auditor e versão do detector.
- Para executar `food-architecture-triage-validate.mjs`, o campo `decisions.inventoryDigest` deve ser o SHA-256 **dos bytes exatos do JSON de inventário extraído**, calculado por `sha256sum inventory.json` e prefixado com `sha256:`. O digest do ZIP publicado pelo GitHub Actions é diferente e não substitui o digest do JSON. Guarde ambos no registro de evidência.
- Não reutilizar um inventário de outro HEAD. Um novo commit invalida o parecer sobre o HEAD anterior.
- O inventário é um detector de candidatos, não uma prova de execução ou de ownership. CI verde não equivale a aprovação independente.

## Fila e ordem de revisão

1. Extrair **todos** os fingerprints do inventário exato da PR, preservando arquivo, linha, regra, classe da matriz de não-recorrência e trechos de evidência. Comparar contagens e digest ao manifesto publicado pelo CI.
2. Deduplicar somente por identidade estável documentada no relatório; ocorrências idênticas em posições diferentes permanecem distintas.
3. Priorizar classes A/B/C/E/I, caminhos produtivos executados pelo runtime e decisões de identidade, porção, macronutrientes ou léxico. A priorização **não dispensa** registrar destino para os demais candidatos.
4. Para cada fingerprint, ler o trecho e a cadeia efetiva de chamada/import; comparar com o owner canônico; quando necessário, reproduzir em teste adversarial positivo e controle negativo.
5. Classificar cada candidato como `confirmed_violation`, `confirmed_non_violation` ou `unresolved`. Nenhum `unresolved` recebe aprovação tácita.
6. Uma violação preexistente confirmada exige dívida nominal válida e issue de migração/retirada, ou correção no código; uma violação nova falha o gate mesmo quando a PR propõe nova dívida. Dívida expirada ou órfã bloqueia.
7. Quando um falso negativo/positivo for demonstrado, adicionar regressão a `scripts/food-architecture-independent-audit.test.ts` e corrigir o detector preservando controles negativos. Reexecutar os testes e o inventário do novo HEAD.

## Registro de cada decisão

Produzir um registro verificável por fingerprint com:

| Campo | Obrigatório |
| --- | --- |
| `sourceSha`, `baselineSha`, `inventoryDigest` | Sim |
| `fingerprint`, `file`, `line`, `ruleId`, `failureClass` | Sim |
| `disposition` | `confirmed_violation`, `confirmed_non_violation` ou `unresolved` |
| `evidence` | Referência verificável de código/runtime/teste e justificativa |
| `canonicalOwnerComparison` | Nome e caminho do owner canônico, ou motivo verificável da não aplicabilidade |
| `debtIssue`, `debtExpiresAt` | Obrigatórios para violação legada aceita |
| `reviewer`, `reviewedAt` | Sim |
| `followUpIssue` | Obrigatória se permanecer `unresolved` |

Não registrar `confirmed_non_violation` por mera ausência de finding adicional ou por nome de diretório. Não registrar `confirmed_violation` apenas porque a heurística reportou um candidato.

## Critérios de conclusão

- Inventário integral do **HEAD final** lido e reconciliado; nenhum fingerprint fica sem disposition e evidência.
- Todas as violações confirmadas têm correção ou dívida pré-existente nominal vigente e rastreável; nenhuma violação nova passa.
- Matriz positiva/negativa independente executada no HEAD final, com evidência bruta reproduzível e resultado terminal do CI desse SHA.
- Revisão separada da implementação registra parecer sobre **o mesmo SHA**, limitações e findings remanescentes.
- Somente aprovação independente, conforme `skill/auditar-issue`, pode sustentar retirada de Draft, merge ou fechamento da Issue #1300. Não fazer merge automático.

## Situação inicial (16/10/2026)

HEAD `9a472bd286b2317aa1462f549d01d56202bf27ba`: artefato `food-architecture-inventory-9a472bd286b2317aa1462f549d01d56202bf27ba` (ID 12063105854; digest publicado `sha256:7b05f9016c9abfb82bf31f0e47d81d581f72f77f8ec45e47308f09eba964ece6`). O CI reportou 2.551 findings, 12 dívidas e 2.539 candidatos de triagem. **Não existe neste documento uma decisão independente por fingerprint.** A certificação permanece pendente.


## Revisão comportamental por fonte — rodada 2026-10-16 (pré-auditoria)

**Base de evidência:** inventário de `9a472bd286b2317aa1462f549d01d56202bf27ba`, artifact `12063105854`. Checkout de código recuperado do bundle `12063515538`. O código de produção não foi alterado entre esse SHA e a rodada inicial de triagem; mudanças posteriores nesta PR alteram somente os próprios verificadores, regressões e documentação. Revalidar as contagens no HEAD final.

**Integridade independente das âncoras:** 2.539 de 2.539 hashes SHA-256 de linhas recalculados sobre os arquivos desse checkout, todos idênticos aos valores declarados em `triage.pending[].evidence.lineSha256`; nenhuma âncora ausente. Isto prova *procedência de fonte*, não certificação de comportamento.

| Referência no código do SHA auditado | Resultado da leitura/execução isolada | Encaminhamento |
| --- | --- | --- |
| `client/src/components/admin/BillingGovernanceAdminPanel.tsx:27,104` | `SIGNAL_ALIASES` e `normalizeSignals` traduzem códigos de governança de uso/billing, não nomes de alimentos. Achados 17 são candidatos sem decisão alimentar demonstrada. | Falso positivo semântico na triagem; não isentar aliases alimentares em outros módulos. |
| `server/modules/foodIntelligenceV2/contracts.ts:341` | `FOOD_CONTRACT_LIMITS` define limites de tamanho de schemas (`rawText`, `identifier`, `collection` etc.), não calorias por alimento. Histórico: três achados 17/5 no mesmo objeto. | Detector refinado para excluir somente limites estruturais sem indexação por identidade alimentar; regressões comprovam bloqueio para novos mapas nutricionais. |
| `server/modules/whatsapp/testFixtures/countableFoodRegistrationParityCases.ts:14-67` | Oito achados de fixtures sintéticas importadas apenas por três arquivos `*.test.ts`, sem import produtivo identificado no grafo de fontes do checkout. | Corrigida exclusão de `testFixtures` isoladas; imports de fixtures por produção continuam bloqueantes, testados em controles positivos/negativos. |
| `server/modules/onboarding/service.ts:64-65` | `resolveNutritionCalculationSex` compara `female`/`male` como sexo biológico, não materialidade de alimento. Dois fingerprints do gate 18 são candidatos indevidos. | Revisão de escopo por semântica; nenhum bypass de materialidade foi publicado. |
| `client/src/features/meals/mealViewModels.ts:163-168` | `totals` inicializa o acumulador do relatório com zero para quatro métricas; não fornece tabela nutricional para alimento específico. | Candidato de apresentação/agrupamento, sem violação de conhecimento alimentar comprovada. |
| `server/modules/whatsapp/foodClarificationContract.ts:77,110,126` | O mapa `SAFE_TYPO_REPLACEMENTS` é aplicado por `normalizeCandidate`; execução isolada do código retornou `iogurte banana` para `iorgute bananna`. | Léxico alimentar legado em canal comprovado por fonte e execução isolada. Migrar pela Issue #1304 (LCL governada); não remover dados do runtime na onda 1. |
| `server/modules/whatsapp/intent/mealItemHelpers.ts:27,145-171` | Na ausência de referência de catálogo, `replaceMealItemFood` passa pelo mapa fixo 150/6/15/5 por 100 g. Execução isolada de ramo com 185 g retornou 277,5 kcal, P 11,1 g, C 27,8 g e G 9,3 g; `source='heuristic'`. Há chamadas produtivas em seleção e substituição de refeições pelo WhatsApp. | Fallback legado explícito, não prova de fallback silencioso. Migração do resolvedor e entrypoints: Issues #1305 e #1308; fora do escopo de remoção total de legado desta issue. |
| `scripts/food-architecture-detector-helpers.ts:117-151` | 490 candidatos do gate 10 são **alcançabilidade transitiva de imports**, agrupados em quatro resolvers legados. O grafo não demonstra, sozinho, que uma chamada decisória usou esse resolver. | Manter pendente até prova de chamada e comparação com owner canônico; não converter automaticamente em 490 violações. |

### Limite da rodada

Não foi emitida disposição conclusiva para todos os 2.539 fingerprints. Os itens listados são revisões específicas, baseadas em fluxo do código, relações de import ou funções isoladas com dependências controladas; **não** equivalem a execução end-to-end em produção. Os candidatos remanescentes continuam `pending-evidence`, e qualquer aprovação independente requer o inventário recompilado no HEAD definitivo, testes e revisão externa à implementação.


### Revisão semântica adicional — mapas numéricos e validação de formulário (16/10/2026)

No inventário do SHA `9a472bd286b2317aa1462f549d01d56202bf27ba`, 12 registros estão no grupo de mapas numéricos de conhecimento alimentar. A leitura do consumo real distinguiu:

- `server/modules/goals/nutritionGoalService.ts#PROTEIN_GRAMS_PER_KG`: fator por **objetivo pessoal de nutrição**, consultado com `input.objective`. Não é mapa por identidade alimentar.
- `server/modules/whatsapp/personalFoodAliasStore.ts#PERSONAL_FOOD_ALIAS_POLICY`: limites de capacidade, TTL e precedência de aliases; não contém tabela de macros de alimentos.
- `server/foodTextNormalization.ts#NUMBER_WORDS`: decisão de quantidade textual no fluxo alimentar; continua no gate.
- `server/mealItemBuilders.ts#GENERIC_ESTIMATED_FOOD_REFERENCE` e `server/modules/whatsapp/intent/mealItemHelpers.ts#HEURISTIC_REPLACEMENT_NUTRITION_PER_100G`: referências nutricionais legadas; permanecem detectadas até migração governada.
- `server/modules/foodIntelligenceV2/contracts.ts#FOOD_CONTRACT_LIMITS`: limites estruturais de schema; isenção estreita já coberta pelas regressões.

Em `client/src/components/admin/NutritionLabelCandidateEditForm.tsx`, comparar `form[field].trim()` e `form.fiber.trim()` com string vazia é validação do formulário, não decisão de materialidade. O detector agora exige conteúdo lexical não vazio nesse tipo de comparação. Testes positivos preservam comparações de materialidade como `light`.

**Escopo da evidência:** leitura de fluxo de fonte e testes adversariais locais sobre o detector; não atribui certificação independente nem elimina pendências não revisadas. Recontar inventário no HEAD final.

## Identidade por ocorrência (revisão de 17/10/2026)
- Uma fingerprint não é necessariamente uma ocorrência única: decisões iguais podem surgir várias vezes na mesma linha e o SHA da linha pode coincidir.
- A fila `triage.pending` preserva cada entrada com `occurrenceIndex` (ordinal de 1 a N por fingerprint/arquivo/linha/regra/classe) e `occurrenceCount` (N).
- A revisão deve indicar o mesmo `occurrenceIndex` e o campo `lineSha256` da respectiva entrada do inventário. O validador rejeita omissões, ordinais duplicados, sequência incompleta, digest incorreto e reutilização de uma única revisão para duas ocorrências.
- Essa identidade resolve a rastreabilidade; **não comprova equivalência semântica ou comportamento**. A aprovação continua independente da implementação.
