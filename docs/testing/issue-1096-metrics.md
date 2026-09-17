# Issue #1096 — relatório de métricas operacionais

## Escopo e snapshots

Este relatório compara a caracterização pública da issue #1094 no snapshot de `develop` que já continha a implementação da #1096 com a mesma caracterização após as correções documentais e os testes runtime desta auditoria. O snapshot de referência é `develop@88848424a7dceee0c84f92fde636c3142bc919fa`, capturado em `2026-09-17T11:34:43Z`. A Fase 3 não altera código de produção: o candidato acrescenta somente testes de reachability e documentação; por isso, a comparação operacional deve ser exatamente nula.

A captura foi feita pelo teste `server/whatsappWebhook.issue1094.characterization.test.ts`, que imprime uma linha `[issue-1094-evidence]` com uma linha de métricas por cenário. A suíte possui **17 testes aprovados** e produz **16 linhas de evidência de cenário**: o teste de controle de falha de persistência não é incluído na lista declarada de cenários, embora também seja executado. A distinção evita confundir contagem de testes com contagem de cenários.

## Comandos reproduzíveis

```text
pnpm vitest run server/whatsappWebhook.issue1094.characterization.test.ts --reporter=dot
pnpm vitest run server/issue1096.bridgeReachability.runtime.test.ts server/issue1096.bridgeReachability.downstream.runtime.test.ts server/issue1096.bridgeReachability.fallback.runtime.test.ts --reporter=dot
pnpm check
```

A linha `[issue-1094-evidence]` deve ser extraída do primeiro comando. Os valores abaixo são agregados com soma por cenário; `max` representa o maior valor em um único cenário. As chaves `nutritionSearchByItem` também são verificadas individualmente.

## Comparação operacional

| Métrica | Baseline #1094 em `develop@8884842` | Candidato após correções | Delta | Invariante verificada |
| --- | ---: | ---: | ---: | --- |
| `processMealInput` — total | 7 | 7 | 0 | O pipeline não é reprocessado pela documentação/testes da #1096. |
| `processMealInput` — máximo por cenário | 1 | 1 | 0 | Uma execução por cenário aplicável. |
| `NUTRITION_SEARCH` attempts — total | 12 | 12 | 0 | Não há nova tentativa causada pela #1096. |
| `NUTRITION_SEARCH` outbound — total | 9 | 9 | 0 | O trabalho externo não aumenta. |
| `NUTRITION_SEARCH` outbound — máximo por item | 1 | 1 | 0 | Produto comercial mantém no máximo uma operação outbound por item. |
| Round-trips estrutura→texto→estrutura — total | 23 | 23 | 0 | Nenhum round-trip adicional foi introduzido. |
| Falhas de round-trip — total | 0 | 0 | 0 | Falhas permanecem zero. |
| Persistências de refeições — total | 12 | 12 | 0 | Nenhuma mutação adicional. |
| Persistências de itens — total | 16 | 16 | 0 | Nenhuma duplicação de item. |
| Claims de pendências — total | 2 | 2 | 0 | Nenhum claim adicional. |
| Pendências consumidas — total | 2 | 2 | 0 | Idempotência e retomada permanecem iguais. |
| Links de domínio — total | 12 | 12 | 0 | Nenhum vínculo adicional. |

Além dos agregados, a caracterização verifica por item que `attempts <= 1` e `outbound <= 1`, que `roundTripFailures` e `fullSemanticRoundTripFailures` são zero, que as violações de ordem de resposta são zero e que o replay não aumenta pesquisa, persistência ou resposta funcional.

## Resultado

A comparação é **aprovada** para o escopo da #1096: o delta operacional é zero e os limites críticos continuam sendo asserts executáveis da caracterização pública. Os testes runtime adicionados não chamam provider, banco ou Cloud API reais; eles apenas observam as delegações dos entrypoints e usam doubles determinísticos. A prova de comportamento permanece nos 17 testes da #1094 e nas suítes específicas de idempotência, mídia, intenção, #1095 e #1072.
