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

## Demais capacidades

`MEAL_TEXT`, `MEAL_VISION`, `WHATSAPP_INTENT`, `QUESTION`, `NUTRITION_SEARCH` e `EMBEDDING` preservam o baseline vigente. O harness executável percorre as fronteiras reais com adapters determinísticos e prova contratos, contagem de chamadas e políticas sem rede; ele não substitui comparação live entre modelos.

`FOOD_CLASSIFICATION` permanece embutida em `MEAL_TEXT`/`MEAL_VISION` e não possui configuração operacional independente nesta fase.

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
