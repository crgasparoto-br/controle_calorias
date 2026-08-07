# Runbook de rollout multi-provider por capacidade

## Finalidade

Este é o runbook canônico para promover ou reverter provider/modelo de uma capacidade de IA. Ele complementa o benchmark em `docs/benchmarks/multi-provider/README.md` e não autoriza mudança de produção por si só.

Nenhuma variável do Render, secret, provider, modelo ou flag de fallback deve ser alterada sem autorização explícita do responsável operacional.

A decisão vigente está versionada em `docs/benchmarks/multi-provider/results/2026-08-05-rollout-decision.json` como `paused-insufficient-evidence`: não há modelo alternativo promovível até existir snapshot imutável observado e preço runtime versionado. Mesmo depois disso, qualquer alteração de produção continuará exigindo autorização explícita na #962.

## Princípios

1. promover uma única capacidade por janela;
2. preservar as demais configurações;
3. manter fallback e cross-provider desabilitados, salvo aprovação específica baseada em evidência;
4. observar somente telemetria sanitizada;
5. interromper diante de regressão funcional, segurança, privacidade, custo inesperado ou aumento material de indisponibilidade;
6. executar rollback alterando somente as variáveis da capacidade promovida.

## Pré-condições

- PR da mudança mergeada e SHA identificado;
- gates de código, testes, arquitetura, documentação e build verdes, incluindo `pnpm smoke:issue-927`;
- relatório do benchmark associado ao SHA e hash da árvore executável validado por `pnpm benchmark:ai:multi-provider:verify`;
- configuração atual e rollback registrados;
- credenciais já gerenciadas pelo ambiente, sem copiar secrets para issue, PR, log ou benchmark;
- janela, responsável e critérios de pausa definidos;
- autorização explícita para alterar produção.

## Estado atual de `TRANSCRIPTION`

Não existe candidato promovível no relatório atual. A comparação live da #924 favorece o alias `gpt-4o-mini-transcribe`, mas a #927 exige snapshot imutável observado e preço versionado para o mesmo modelo; como essa evidência ainda não existe, a política é `keep-baseline` e a #962 deve permanecer pausada para troca de modelo.

Configuração mantida até nova evidência reproduzível:

```text
AI_TRANSCRIPTION_PROVIDER=openai
AI_TRANSCRIPTION_MODEL=whisper-1
AI_TRANSCRIPTION_MAX_ATTEMPTS=1
AI_TRANSCRIPTION_FALLBACK_ENABLED=false
AI_TRANSCRIPTION_CROSS_PROVIDER_FALLBACK_ENABLED=false
```

Rollback/baseline conhecido:

```text
AI_TRANSCRIPTION_PROVIDER=openai
AI_TRANSCRIPTION_MODEL=whisper-1
AI_TRANSCRIPTION_MAX_ATTEMPTS=1
AI_TRANSCRIPTION_FALLBACK_ENABLED=false
AI_TRANSCRIPTION_CROSS_PROVIDER_FALLBACK_ENABLED=false
```

Antes de qualquer promoção futura, repetir a comparação live com um snapshot imutável explicitamente registrado, incluir esse modelo no catálogo runtime com preço oficial versionado e então validar áudio PT-BR com termos alimentares, marcas, pesos, unidades, ruído e fala ambígua. Confirmar texto útil, erros controlados, ausência de mutação duplicada e ausência de conteúdo sensível na telemetria.

## `IMAGE_ANNOTATION`

Manter:

```text
AI_IMAGE_ANNOTATION_MODE=local
AI_IMAGE_ANNOTATION_FALLBACK_ENABLED=false
AI_IMAGE_ANNOTATION_CROSS_PROVIDER_FALLBACK_ENABLED=false
```

O modo local evita segundo envio da foto e é a opção de rollback. O modo `off` pode ser usado para interromper a geração do derivado sem afetar a refeição. Não promover o modo externo sem benchmark próprio, revisão de privacidade e autorização.

## Matriz de rollback por capacidade

A prontidão da #927 usa como baseline técnico os defaults/compatibilidades versionados no resolvedor. A configuração efetiva do Render deve ser capturada pela #962 **antes** de qualquer alteração e prevalece como snapshot operacional para a reversão. Se o snapshot observado divergir desta tabela, pausar a janela e reconciliar a diferença antes de promover.

Em toda reversão, restaurar somente as variáveis da capacidade afetada, manter `FALLBACK_ENABLED=false` e `CROSS_PROVIDER_FALLBACK_ENABLED=false`, e executar o smoke sanitizado da capacidade após a restauração. `pnpm smoke:issue-927` continua sendo o controle hermético de contrato; a #962 registra o smoke live autorizado antes/depois da mudança e após eventual rollback.

| Capacidade | Baseline técnico versionado | Política de rollback | Condição objetiva de rollback | Smoke após reversão | `degraded` / `disabled` |
| --- | --- | --- | --- | --- | --- |
| `MEAL_TEXT` | `AI_MEAL_TEXT_PROVIDER=openai`; `AI_MEAL_TEXT_MODEL=gpt-4.1-mini`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar provider/modelo/timeout/tentativas capturados; `AI_MEAL_TEXT_FALLBACK_ENABLED=false`; `AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED=false` | regressão em payload válido, marca/quantidade/unidade/nutrição, resultado válido acionando retry/fallback, segurança/privacidade ou custo/latência fora do limite aprovado | refeição sintética simples + ambígua/adversarial, incluindo `items: []` válido sem nova chamada | `degraded`: não promover fallback inválido/cross-provider; `disabled`: indisponibilidade controlada, sem segundo provider automático |
| `MEAL_VISION` | `AI_MEAL_VISION_PROVIDER=openai`; `AI_MEAL_VISION_MODEL=gpt-4.1-mini`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar snapshot da capacidade; `AI_MEAL_VISION_FALLBACK_ENABLED=false`; `AI_MEAL_VISION_CROSS_PROVIDER_FALLBACK_ENABLED=false` | regressão de identificação/quantidade/unidade/classificação NOVA, foto sem alimento acionando fallback, segundo envio indevido ou regressão de privacidade | foto sintética com alimento + sem alimento, confirmando ausência de fallback para resultado funcional válido | `degraded`: manter baseline sem segundo envio; `disabled`: falha controlada da visão, preservando o fluxo documentado |
| `WHATSAPP_INTENT` | `AI_WHATSAPP_INTENT_PROVIDER=openai`; `AI_WHATSAPP_INTENT_MODEL=gpt-4.1-mini`; timeout `8000`; `MAX_ATTEMPTS=2` | restaurar snapshot, inclusive os defaults legados equivalentes; `AI_WHATSAPP_INTENT_FALLBACK_ENABLED=false`; `AI_WHATSAPP_INTENT_CROSS_PROVIDER_FALLBACK_ENABLED=false` | comando determinístico/operação pendente passar a chamar LLM, quebra de idempotência/isolamento/correlação, intenção incorreta crítica ou fallback indevido | comando determinístico com zero outbound + operação pendente/correção/substituição/exclusão | `degraded`: não habilitar fallback para contornar configuração; `disabled`: resposta controlada sem consumir pendência nem duplicar mutação |
| `QUESTION` | `AI_QUESTION_PROVIDER=openai`; `AI_QUESTION_MODEL=gpt-4.1-mini`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar snapshot; `AI_QUESTION_FALLBACK_ENABLED=false`; `AI_QUESTION_CROSS_PROVIDER_FALLBACK_ENABLED=false`; manter `AI_QUESTION_WEB_SEARCH_MODE=auto` salvo snapshot diferente registrado | mutação indevida, ferramenta forçada quando não necessária, regressão de resposta útil, custo/fallback inesperado ou privacidade | pergunta `/` sem busca + pergunta que disponibiliza pesquisa em modo `auto` | `degraded`: manter somente leitura e baseline; `disabled`: indisponibilidade controlada, sem mutação e sem segundo provider |
| `NUTRITION_SEARCH` | `AI_NUTRITION_SEARCH_PROVIDER=openai`; `AI_NUTRITION_SEARCH_MODEL=gpt-4.1-mini`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar snapshot; `AI_NUTRITION_SEARCH_FALLBACK_ENABLED=false`; `AI_NUTRITION_SEARCH_CROSS_PROVIDER_FALLBACK_ENABLED=false` | fonte não verificável, SKU/marca/porção ambígua promovida, URL/evidência fabricada, fallback externo para `safe-no-match` ou regressão de custo/privacidade | busca com fonte verificável + caso ambíguo/sem evidência que deve terminar em `safe-no-match` | `degraded`/`disabled`: usar somente fallback nutricional canônico permitido; nunca transformar estimativa em dado pesquisado |
| `EMBEDDING` | `AI_EMBEDDING_PROVIDER=openai`; `AI_EMBEDDING_MODEL=text-embedding-3-small`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar snapshot; `AI_EMBEDDING_FALLBACK_ENABLED=false`; `AI_EMBEDDING_CROSS_PROVIDER_FALLBACK_ENABLED=false` | quebra de dimensão/contrato, mistura de espaços vetoriais, chamada textual como substituto ou falha de degradação canônica | embedding sintético + indisponibilidade forçada confirmando busca não semântica | `degraded`/`disabled`: degradar para busca textual/canônica não semântica; não consultar outro provider |
| `TRANSCRIPTION` | `AI_TRANSCRIPTION_PROVIDER=openai`; `AI_TRANSCRIPTION_MODEL=whisper-1`; timeout `30000`; `MAX_ATTEMPTS=1` | restaurar `whisper-1` e flags desabilitadas; não usar alias mutável como rollback | texto inútil, regressão PT-BR/termos críticos, duplicidade de transcrição/mutação, segurança/privacidade, custo/latência fora do limite aprovado | áudio sintético PT-BR com termos alimentares + callback duplicado sem segunda mutação | `degraded`: manter `whisper-1`; `disabled`: falha controlada, sem registro vazio nem consumo de pendência |
| `IMAGE_ANNOTATION` | `AI_IMAGE_ANNOTATION_MODE=local`; `AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=off`; fallback/cross-provider desabilitados | restaurar `local`; opcionalmente `off` para interromper derivado; não exigir provider/modelo externo | original alterado, derivado não baseado no original, segundo envio não autorizado, falha bloqueando refeição ou regressão de privacidade | foto sintética no modo `local`, original inalterado, derivado separado; `off` sem chamada externa | `degraded`: preferir `local`; `disabled/off`: concluir sem anotação, sem bloquear refeição |

`FOOD_CLASSIFICATION` permanece embutida em `MEAL_TEXT`/`MEAL_VISION` e não possui configuração operacional independente. Seu rollback ocorre junto da capacidade que produziu a classificação; uma chamada externa separada é regressão e exige pausa.

### Tratamento comum de estado durante rollback

- `ready`: prosseguir somente se provider/modelo e operações exigidas coincidirem com o snapshot restaurado.
- `degraded`: não promover nem habilitar segundo provider para mascarar configuração parcial; preservar a degradação local/canônica documentada para a capacidade.
- `disabled`: não contornar ausência de segredo/configuração com fallback externo; manter indisponibilidade controlada ou degradação local/canônica prevista.
- `invalid`: interromper a janela, restaurar o snapshot anterior e não executar tráfego adicional até a configuração voltar a um estado aceito.

## Fallback same-provider

Só habilitar quando houver cenário de falha elegível reproduzido, ganho demonstrado, custo conhecido e rollback. Regras obrigatórias:

- flag independente por capacidade;
- no máximo uma chamada de fallback após as tentativas do primário;
- execução sequencial, sem cadeia e sem retorno ao primário;
- resultado funcional válido não dispara fallback;
- configuração, autenticação, incompatibilidade, modelo inexistente conhecido e bloqueio de segurança não disparam fallback.

## Cross-provider

Permanece desabilitado em produção. Antes de qualquer habilitação, exigir para a capacidade específica:

- comparação live e reproduzível;
- revisão LGPD do segundo envio e transferência internacional;
- validação de schema e contrato em ambos os providers;
- custo, retenção, observabilidade e rollback;
- autorização explícita da operação.

## Observação e decisão

Durante uma janela autorizada, acompanhar por capacidade e modelo efetivo:

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

Registrar sem conteúdo sensível:

- data, região, ambiente e endpoint class;
- SHA, versão do catálogo e modelos/snapshots;
- capacidade, configuração anterior, configuração promovida e rollback;
- quantidade de amostras e período;
- métricas agregadas;
- decisão e responsável autorizado.

A remoção futura das variáveis legadas está separada na issue #960 e não faz parte do rollout inicial.
