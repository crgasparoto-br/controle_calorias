# Evidências históricas de entrega

Os arquivos JSON deste diretório são registros legados de execuções anteriores de `entregar-issue`. Seus SHAs, execuções de CI e referências de material head identificam **somente** a entrega histórica para a qual foram emitidos. Em particular, `exact-head-evidence.json` referencia `d0da06cb4f4a8f3785d940f94141ef4c72736163` e **não** certifica o HEAD corrente da PR #1316.

O contrato canônico vigente está em `docs/audit/github-native-contract.json` na branch base `develop`, com `audit_mode: native-github`, `legacy_handoff_policy: not-required`, `exact_sha_evidence: true` e `independent_review: true`. Para auditar a PR, consulte diretamente o HEAD atual no GitHub, seu diff e os checks vinculados exatamente a esse SHA; não considere os JSONs históricos como evidência atual, nem exija sua regeneração.

O corpus e o harness da Issue #1299 pertencem à Fase A de calibração: seus arquivos `*.test.support.ts` são a implementação de suporte a testes, reexportada pelos barrels estáveis (`contracts.ts`, `harness.ts` etc.). Isso não autoriza um consumidor de produção. O isolamento é verificado em `server/modules/foodIntelligenceV2/noProductionConsumer.test.ts`; qualquer integração futura com runtime produtivo requer escopo, revisão e testes próprios.

Os testes do corpus demonstram o comportamento do harness e da referência independente, **não** a taxa de acerto do resolvedor V2 em produção. A meta produtiva deve ser avaliada separadamente, com dados rotulados independentes e as decisões de rollout pertinentes.
