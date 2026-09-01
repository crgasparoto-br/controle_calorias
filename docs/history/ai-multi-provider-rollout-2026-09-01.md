# Registro operacional — rollout multi-provider por capacidade (#962)

## Estado registrado

Em 2026-09-01, o responsável operacional confirmou na issue #962 que o rollout das configurações de IA por capacidade foi executado no Render e que as configurações estão implementadas e funcionando em produção.

Este registro encerra documentalmente o passo de implantação/configuração por capacidade. Ele não reexecuta o rollout nem altera o Render.

## Escopo da confirmação

A arquitetura separa a configuração de IA pelas capacidades `MEAL_TEXT`, `MEAL_VISION`, `WHATSAPP_INTENT`, `QUESTION`, `NUTRITION_SEARCH`, `EMBEDDING`, `TRANSCRIPTION` e `IMAGE_ANNOTATION`. `FOOD_CLASSIFICATION` permanece embutida em `MEAL_TEXT`/`MEAL_VISION` e não possui configuração operacional independente.

A confirmação operacional significa que as configurações necessárias no Render para essa arquitetura por capacidade foram implantadas e estão funcionais em produção. Os valores efetivos do ambiente continuam sendo gerenciados no Render e não são copiados para este repositório.

## Relação com a evidência histórica da #927

Os artefatos em `docs/benchmarks/multi-provider/results/` permanecem imutáveis como evidência histórica da #927. Em particular, `2026-08-05-rollout-decision.json` registra corretamente o estado observado naquele momento (`paused-insufficient-evidence` e `productionChangesApplied=false`). Esses campos descrevem a decisão e a execução da #927 em agosto e não representam o estado atual de produção após a execução operacional posterior da #962.

A comparação histórica de `TRANSCRIPTION` com `gpt-4o-mini-transcribe` continua sendo apenas evidência do benchmark daquele período. Este registro não altera retroativamente os critérios de reprodutibilidade usados pela #927.

## Baseline técnico versus configuração efetiva

Defaults e baselines versionados, como `openai` + `whisper-1` para `TRANSCRIPTION`, continuam úteis para compatibilidade, comportamento sem override e referência de rollback técnico. Eles não devem ser usados para inferir qual provider/modelo está efetivamente configurado no Render depois do rollout da #962.

Para qualquer mudança operacional futura, a fonte operacional deve ser a configuração efetiva observada no Render no início da janela autorizada. Essa configuração deve ser capturada antes da alteração e tratada como snapshot de rollback da nova janela.

## Evidência que este registro não inventa

A confirmação recebida comprova o estado operacional do passo de implantação, mas não fornece detalhes suficientes para registrar retroativamente:

- os valores exatos de provider/modelo de cada capacidade;
- o snapshot completo da configuração anterior à mudança;
- horário e resultado individual de cada smoke pré/pós-mudança;
- série de p50/p95, custo, timeout ou indisponibilidade observada durante a janela;
- exercício de rollback por capacidade e respectivo smoke pós-reversão.

Esses itens só devem ser marcados como executados quando houver evidência sanitizada correspondente. Não reconstruir valores ou resultados por inferência.

## Regras preservadas

- novas trocas continuam sendo feitas por capacidade, e não por chave global;
- a configuração efetiva deve ser capturada antes de cada mudança futura;
- fallback e cross-provider continuam sujeitos aos guardrails do código, do runbook, de privacidade e de autorização aplicáveis;
- artefatos históricos de benchmark não devem ser reescritos para refletir estado operacional posterior;
- o runbook `docs/runbooks/multi-provider-rollout.md` continua sendo o procedimento canônico para futuras mudanças e reversões.

## Fonte

- issue operacional: #962;
- confirmação do responsável em 2026-09-01: configurações do Render implementadas e funcionando em produção;
- base documental: #917, #927 e `docs/runbooks/multi-provider-rollout.md`.
