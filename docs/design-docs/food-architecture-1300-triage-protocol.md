# Issue #1300 — protocolo de triagem independente do inventário

> Estado: **pendente de certificação**. Este documento não certifica candidatos, não altera a baseline imutável e não autoriza merge.

## Identidade e evidências obrigatórias

- Repositório: `crgasparoto-br/controle_calorias`.
- PR: #1324, base `develop`.
- Registrar em cada execução: SHA integral da PR, SHA da baseline arquitetural, nome e digest SHA-256 do artefato `food-architecture-inventory-<SHA>`, data UTC, auditor e versão do detector.
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
