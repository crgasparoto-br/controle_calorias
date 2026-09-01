# Runbook de rollout multi-provider por capacidade

## Finalidade

Este é o runbook canônico para promover ou reverter provider/modelo de uma capacidade de IA. Ele complementa o benchmark em `docs/benchmarks/multi-provider/README.md` e não autoriza mudança de produção por si só.

Nenhuma variável do Render, provider, modelo ou flag de fallback deve ser alterada sem autorização explícita do responsável operacional.

O snapshot `docs/benchmarks/multi-provider/results/2026-08-05-rollout-decision.json` permanece imutável como evidência histórica da #927 e registra corretamente o estado daquele momento como `paused-insufficient-evidence`. Ele não representa mais o estado operacional atual: em 2026-09-01, o responsável confirmou na #962 que as configurações de IA por capacidade foram implantadas no Render e estão funcionando em produção. O registro sanitizado dessa conclusão está em `docs/history/ai-multi-provider-rollout-2026-09-01.md`.

Os valores efetivos do ambiente não são duplicados neste documento. Para qualquer janela futura, a fonte operacional é a configuração efetiva observada no Render no início da janela, capturada antes de qualquer alteração.

## Estado operacional registrado em 2026-09-01

- rollout/configuração por capacidade no Render: concluído;
- estado informado pelo responsável: configurações implementadas e funcionando em produção;
- arquitetura por capacidade: ativa para `MEAL_TEXT`, `MEAL_VISION`, `WHATSAPP_INTENT`, `QUESTION`, `NUTRITION_SEARCH`, `EMBEDDING`, `TRANSCRIPTION` e `IMAGE_ANNOTATION`;
- `FOOD_CLASSIFICATION`: permanece embutida em `MEAL_TEXT`/`MEAL_VISION`, sem configuração operacional independente;
- artefatos históricos da #927: preservados sem reescrita;
- valores efetivos de provider/modelo: permanecem no Render e não são inferidos a partir dos defaults versionados;
- métricas detalhadas, smoke individual e exercício de rollback: somente devem ser marcados como executados quando houver evidência sanitizada correspondente.

## Princípios

1. promover uma única capacidade por janela;
2. preservar as demais configurações;
3. manter fallback e cross-provider desabilitados, salvo aprovação específica baseada em evidência;
4. observar somente telemetria sanitizada;
5. interromper diante de regressão funcional, segurança, privacidade, custo inesperado ou aumento material de indisponibilidade;
6. executar rollback alterando somente as variáveis da capacidade promovida.

## Pré-condições para novas mudanças

- SHA candidato identificado;
- gates de código, testes, arquitetura, documentação e build verdes, incluindo `pnpm smoke:issue-927` quando aplicável;
- relatório do benchmark associado ao SHA e hash da árvore executável validado por `pnpm benchmark:ai:multi-provider:verify` quando a mudança depender de nova evidência de modelo;
- configuração efetiva atual capturada como snapshot de rollback da nova janela;
- credenciais já gerenciadas pelo ambiente, sem copiar valores para issue, PR, log ou benchmark;
- janela, responsável e critérios de pausa definidos;
- autorização explícita para alterar produção.

## `TRANSCRIPTION`: baseline técnico e configuração efetiva

A conclusão histórica da #927 continua válida para o benchmark daquele período: a comparação live favorecia o alias `gpt-4o-mini-transcribe`, mas não havia snapshot imutável observado e preço versionado para o mesmo modelo. Por isso a #927 manteve `keep-baseline`; esse fato não deve ser usado para inferir a configuração efetiva atual do Render depois da execução operacional da #962.

Baseline técnico versionado e fallback de compatibilidade:

```text
AI_TRANSCRIPTION_PROVIDER=openai
AI_TRANSCRIPTION_MODEL=whisper-1
AI_TRANSCRIPTION_MAX_ATTEMPTS=1
AI_TRANSCRIPTION_FALLBACK_ENABLED=false
AI_TRANSCRIPTION_CROSS_PROVIDER_FALLBACK_ENABLED=false
```

Referência técnica de rollback quando a configuração efetiva da janela não indicar outro snapshot autorizado:

```text
AI_TRANSCRIPTION_PROVIDER=openai
AI_TRANSCRIPTION_MODEL=whisper-1
AI_TRANSCRIPTION_MAX_ATTEMPTS=1
AI_TRANSCRIPTION_FALLBACK_ENABLED=false
AI_TRANSCRIPTION_CROSS_PROVIDER_FALLBACK_ENABLED=false
```

Antes de qualquer nova promoção de `TRANSCRIPTION`, repetir a comparação live com um snapshot imutável explicitamente registrado, incluir esse modelo no catálogo runtime com preço oficial versionado e então validar áudio PT-BR com termos alimentares, marcas, pesos, unidades, ruído e fala ambígua. Confirmar texto útil, erros controlados, ausência de mutação duplicada e ausência de conteúdo sensível na telemetria.

## `IMAGE_ANNOTATION`

Baseline técnico versionado:

```text
AI_IMAGE_ANNOTATION_MODE=local
AI_IMAGE_ANNOTATION_FALLBACK_ENABLED=false
AI_IMAGE_ANNOTATION_CROSS_PROVIDER_FALLBACK_ENABLED=false
```

O modo local evita segundo envio da foto e é a opção técnica de degradação/rollback. O modo `off` pode ser usado para interromper a geração do derivado sem afetar a refeição. Qualquer promoção futura do modo externo continua exigindo benchmark próprio, revisão de privacidade e autorização.

## Matriz de rollback por capacidade

A prontidão da #927 usa como baseline técnico os defaults/compatibilidades versionados no resolvedor. Para o rollout já executado na #962, a configuração efetiva corrente do Render passa a ser o ponto de partida operacional para qualquer mudança futura. Antes da próxima alteração, capturar essa configuração e usá-la como snapshot de rollback da nova janela.

Não reconstruir retroativamente o snapshot anterior ao rollout de 2026-09-01 por inferência. Se esse snapshot ou um exercício de rollback histórico não estiverem registrados em evidência sanitizada, tratá-los como evidência ausente, não como execução presumida.

Em toda reversão futura, restaurar somente as variáveis da capacidade afetada, manter `FALLBACK_ENABLED=false` e `CROSS_PROVIDER_FALLBACK_ENABLED=false` salvo aprovação específica, e executar o smoke sanitizado da capacidade após a restauração. `pnpm smoke:issue-927` continua sendo o controle hermético de contrato; a janela operacional registra o smoke live autorizado antes/depois da mudança e após eventual rollback.

| Capacidade | Baseline técnico versionado | Política de rollback | Condição objetiva de rollback | Smoke após reversão | `degraded` / `disabled` |
| --- | --- | --- | --- | --- | --- |
| `MEAL_TEXT` | `AI_MEAL_TEXT_PROVIDER=openai`; `AI_MEAL_TEXT_MODEL=gpt-4.1-mini`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar provider/modelo/timeout/tentativas capturados; `AI_MEAL_TEXT_FALLBACK_ENABLED=false`; `AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED=false` | regressão em payload válido, marca/quantidade/unidade/nutrição, resultado válido acionando retry/fallback, segurança/privacidade ou custo/latência fora do limite aprovado | refeição sintética simples + ambígua/adversarial, incluindo `items: []` válido sem nova chamada | `degraded`: não promover fallback inválido/cross-provider; `disabled`: indisponibilidade controlada, sem segundo provider automático |
| `MEAL_VISION` | `AI_MEAL_VISION_PROVIDER=openai`; `AI_MEAL_VISION_MODEL=gpt-4.1-mini`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar snapshot da capacidade; `AI_MEAL_VISION_FALLBACK_ENABLED=false`; `AI_MEAL_VISION_CROSS_PROVIDER_FALLBACK_ENABLED=false` | regressão de identificação/quantidade/unidade/classificação NOVA, foto sem alimento acionando fallback, segundo envio indevido ou regressão de privacidade | foto sintética com alimento + sem alimento, confirmando ausência de fallback para resultado funcional válido | `degraded`: manter baseline sem segundo envio; `disabled`: falha controlada da visão, preservando o fluxo documentado |
| `WHATSAPP_INTENT` | `AI_WHATSAPP_INTENT_PROVIDER=openai`; `AI_WHATSAPP_INTENT_MODEL=gpt-4.1-mini`; timeout `8000`; `MAX_ATTEMPTS=2` | restaurar snapshot, inclusive os defaults legados equivalentes; `AI_WHATSAPP_INTENT_FALLBACK_ENABLED=false`; `AI_WHATSAPP_INTENT_CROSS_PROVIDER_FALLBACK_ENABLED=false` | comando determinístico/operação pendente passar a chamar LLM, quebra de idempotência/isolamento/correlação, intenção incorreta crítica ou fallback indevido | comando determinístico com zero outbound + operação pendente/correção/substituição/exclusão | `degraded`: não habilitar fallback para contornar configuração; `disabled`: resposta controlada sem consumir pendência nem duplicar mutação |
| `QUESTION` | `AI_QUESTION_PROVIDER=openai`; `AI_QUESTION_MODEL=gpt-4.1-mini`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar snapshot; `AI_QUESTION_FALLBACK_ENABLED=false`; `AI_QUESTION_CROSS_PROVIDER_FALLBACK_ENABLED=false`; manter `AI_QUESTION_WEB_SEARCH_MODE=auto` salvo snapshot diferente registrado | mutação indevida, ferramenta forçada quando não necessária, regressão de resposta útil, custo/fallback inesperado ou privacidade | pergunta `/` sem busca + pergunta que disponibiliza pesquisa em modo `auto` | `degraded`: manter somente leitura e baseline; `disabled`: indisponibilidade controlada, sem mutação e sem segundo provider |
| `NUTRITION_SEARCH` | `AI_NUTRITION_SEARCH_PROVIDER=openai`; `AI_NUTRITION_SEARCH_MODEL=gpt-4.1-mini`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar snapshot; `AI_NUTRITION_SEARCH_FALLBACK_ENABLED=false`; `AI_NUTRITION_SEARCH_CROSS_PROVIDER_FALLBACK_ENABLED=false` | fonte não verificável, SKU/marca/porção ambígua promovida, URL/evidência fabricada, fallback externo para `safe-no-match` ou regressão de custo/privacidade | busca com fonte verificável + caso ambíguo/sem evidência que deve terminar em `safe-no-match` | `degraded`/`disabled`: usar somente fallback nutricional canônico permitido; nunca transformar estimativa em dado pesquisado |
| `EMBEDDING` | `AI_EMBEDDING_PROVIDER=openai`; `AI_EMBEDDING_MODEL=text-embedding-3-small`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar snapshot; `AI_EMBEDDING_FALLBACK_ENABLED=false`; `AI_EMBEDDING_CROSS_PROVIDER_FALLBACK_ENABLED=false` | quebra de dimensão/contrato, mistura de espaços vetoriais, chamada textual como substituto ou falha de degradação canônica | embedding sintético + indisponibilidade forçada confirmando busca não semântica | `degraded`/`disabled`: degradar para busca textual/canônica não semântica; não consultar outro provider |
| `TRANSCRIPTION` | `AI_TRANSCRIPTION_PROVIDER=openai`; `AI_TRANSCRIPTION_MODEL=whisper-1`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar o snapshot efetivo capturado para a janela; `whisper-1` permanece a referência técnica versionada quando não houver override autorizado | texto inútil, regressão PT-BR/termos críticos, duplicidade de transcrição/mutação, segurança/privacidade, custo/latência fora do limite aprovado | áudio sintético PT-BR com termos alimentares + callback duplicado sem segunda mutação | `degraded`: usar a política aprovada da janela; `disabled`: falha controlada, sem registro vazio nem consumo de pendência |
| `IMAGE_ANNOTATION` | `AI_IMAGE_ANNOTATION_MODE=local`; `AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=off`; fallback/cross-provider desabilitados | restaurar snapshot da janela; `local` permanece a referência técnica e `off` pode interromper derivado | original alterado, derivado não baseado no original, segundo envio não autorizado, falha bloqueando refeição ou regressão de privacidade | foto sintética no modo restaurado; se `local`, original inalterado e derivado separado; se `off`, sem chamada externa | `degraded`: preferir política local aprovada; `disabled/off`: concluir sem anotação, sem bloquear refeição |

`FOOD_CLASSIFICATION` permanece embutida em `MEAL_TEXT`/`MEAL_VISION` e não possui configuração operacional independente. Seu rollback ocorre junto da capacidade que produziu a classificação; uma chamada externa separada é regressão e exige pausa.

### Tratamento comum de estado durante rollback

- `ready`: prosseguir somente se provider/modelo e operações exigidas coincidirem com o snapshot restaurado.
- `degraded`: não promover nem habilitar segundo provider para mascarar configuração parcial; preservar a degradação local/canônica documentada para a capacidade.
- `disabled`: não contornar ausência de configuração com fallback externo; manter indisponibilidade controlada ou degradação local/canônica prevista.
- `invalid`: interromper a janela, restaurar o snapshot anterior e não executar tráfego adicional até a configuração voltar a um estado aceito.

## Fallback same-provider

Só habilitar quando houver cenário de falha elegível reproduzido, ganho demonstrado, custo conhecido e rollback. Regras obrigatórias:

- flag independente por capacidade;
- no máximo uma chamada de fallback após as tentativas do primário;
- execução sequencial, sem cadeia e sem retorno ao primário;
- resultado funcional válido não dispara fallback;
- configuração, autenticação, incompatibilidade, modelo inexistente conhecido e bloqueio de segurança não disparam fallback.

## Cross-provider

Permanece desabilitado em produção enquanto os guardrails atuais do código assim determinarem. Antes de qualquer habilitação futura, exigir para a capacidade específica:

- comparação live e reproduzível;
- revisão LGPD do segundo envio e transferência internacional;
- validação de schema e contrato em ambos os providers;
- custo, retenção, observabilidade e rollback;
- autorização explícita da operação.

## Observação e decisão

Durante uma nova janela autorizada, acompanhar por capacidade e modelo efetivo:

- sucesso funcional e checks críticos;
- falsos positivos e fontes verificáveis;
- p50/p95, timeout e indisponibilidade;
- retry/fallback e motivo normalizado;
- custo estimado e percentual de custo `null`;
- regressões de segurança/privacidade;
- duplicidade de mutação ou quebra de continuidade no WhatsApp.

Classificar a janela como:

- **continuar**: métricas dentro dos limites e sem regressão;
- **pausar**: evidência insuficiente ou anomalia ainda não atribuída;
- **reverter**: regressão funcional, segurança/privacidade, aumento material de erro/latência/custo ou contrato incompatível.

## Registro de evidência

Registrar sem conteúdo de usuário:

- data, região, ambiente e endpoint class;
- SHA, versão do catálogo e modelos/snapshots;
- capacidade, configuração anterior, configuração promovida e rollback;
- quantidade de amostras e período;
- métricas agregadas;
- decisão e responsável autorizado.

A remoção futura das variáveis legadas está separada na issue #960 e não faz parte do rollout inicial.
