# Issue #1095 — consolidação de owners de identidade, medida e contrato

## Baseline registrada antes da alteração

A implementação foi iniciada a partir da branch `develop` do repositório `crgasparoto-br/controle_calorias`, no SHA `748482243a5f5aa9ca5050a7b1c228458219ad1e`. A issue predecessora #1094 foi revalidada antes da alteração com **17/17 testes aprovados**, e a matriz regressiva contável vigente foi executada com **26/26 testes aprovados**.

Os comandos usados para a caracterização foram:

```text
pnpm vitest run server/whatsappWebhook.issue1094.characterization.test.ts --reporter=dot
pnpm vitest run server/modules/whatsapp/countableFoodRegistrationGate.issue1072.test.ts server/modules/whatsapp/countableFoodRegistrationGate.issue1047.integration.test.ts server/countableFoodQuantity.issue1072.searchContext.test.ts server/countableFoodQuantity.issue1047.test.ts server/modules/whatsapp/mealIntentRegistrationDetailsInteraction.issue1057.test.ts --reporter=dot
```

A baseline mediu `processMealInput`, construção de contratos, round-trips, pesquisas externas, persistência, pendências e verificações de monotonicidade por cenário. Esses contadores permanecem a referência para a comparação pós-consolidação; nenhuma operação externa foi adicionada.

## Revalidação dos findings F0-01 a F0-04

| Finding | Decisão e owner pós-#1095 | Compatibilidade e controle |
| --- | --- | --- |
| F0-01 — predicados de identidade comercial | `compareCommercialIdentity` centraliza normalização, tokens e variantes em `commercialProductIdentity.ts`. `isPersistedProductIdentityCompatible` e `isCommercialProductIdentityCompatible` continuam guards distintos, com invariantes próprios. | Testes bidirecionais cobrem identidade aceita, variante conflitante e candidato genérico que não pode selecionar uma variante específica. |
| F0-02 — preparação contável duplicada | `prepareLocalCountableFoodRegistration` é o estágio local do owner assíncrono `prepareCountableFoodRegistrationResolved`. `prepareCountableFoodRegistration` permanece somente como adaptador síncrono histórico, sem decisão duplicada. | A suíte #1047, a auditoria #1055 e os testes #1072 permanecem verdes. O owner retorna segmentos, resoluções, pendências e texto canônico na mesma estrutura. |
| F0-03 — materialização no canal | `materializeResolvedCommercialMeal` é a fronteira de domínio para resultado, item, contrato semântico e totais. `buildItemFromResolvedCommercialFood` preserva o `CatalogFood`, a proveniência comercial e separa quantidade/unidade originais da gramatura derivada. | O gate WhatsApp não mantém builder paralelo. A adição canônica também materializa diretamente o `CatalogFood` comercial e não chama `processMealInput` para re-resolver a identidade. |
| F0-04 — preflight re-resolvente | `resolveStructuredCommercialIdentity` resolve marca/variante somente a partir dos fatos estruturados e da evidência textual; `recoverCanonicalCommercialIdentity` continua como adaptador histórico que não consulta o runtime legado. | A prova #1016 foi atualizada para exigir `processMealInput` não chamado no caminho comercial já aceito. O preflight do consumidor direto continua existindo para entradas genéricas ou não comerciais. |

## Resultado pós-implementação

A matriz da #1094 permaneceu verde com **17/17 testes aprovados**. Os contadores não aumentaram: nos cenários de clarificação/retomada, `processMealInput`, round-trips e contratos diminuíram de 2/3/3 para 1/2/2 por retomada; nos demais cenários permaneceram no mesmo limite da baseline. A contagem de `NUTRITION_SEARCH` por item continuou no máximo em uma operação outbound, inclusive para produtos comerciais com cache vazio ou incompatível.

Foram adicionados testes focados em `server/issue1095.ownershipConsolidation.test.ts`, cobrindo os guards compartilhados, o preflight textual estruturado e a materialização monotônica de identidade, medida, macros e proveniência. A regressão histórica #1016 agora documenta explicitamente que a identidade comercial aceita não retorna ao pipeline geral apenas para reconstruir o item persistível.

## Escopo preservado

A alteração não remove wrappers do webhook, não troca provider/modelo, não relaxa fail-closed, não cria uma segunda fonte de cálculo nutricional e não altera a persistência de texto original. A compatibilidade histórica permanece por adaptadores finos e os contratos antigos continuam legíveis.


## Correção após a primeira auditoria independente

A primeira auditoria encontrou uma falha bloqueadora em `confirmedMealRegistration.ts`: a lista final de itens multi-item era achatada, mas o contrato semântico herdado de `parts[0]` não era reconstruído. A correção agora chama o owner `buildMealSemanticContract` uma única vez com todos os itens e com o texto original agregado. A regressão `confirmedMealRegistration.issue1095.test.ts` exige cardinalidade completa, variante/proveniência comercial e o item irmão no contrato final.

Durante a revalidação apareceu uma incompatibilidade de restart que a auditoria de ciclo também capturou: `sourceVerifiedAt` persistido em JSON retorna como string. `mealSemanticContract.ts` passou a normalizar `Date|string` de forma fail-safe antes de serializar a evidência, sem alterar o valor da proveniência. O cenário 15 da #1094 voltou a passar com `pendingConsumed=1`, `persistedMeals=1` e sem duplicação do inbound.

Após essas correções, a caracterização pública da #1094 passou novamente **17/17**, a suíte regressiva contável/adição passou **34/34**, a suíte de confirmação/contrato passou **8/8**, a suíte focada de ownership passou **4/4** e `pnpm run check` passou. A auditoria independente final deve confirmar que não restam pendências bloqueadoras.
