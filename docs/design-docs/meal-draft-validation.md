# Validacao backend de rascunho alimentar

## Contexto

A issue #412 exige que interpretacoes estruturadas da IA sejam validadas no backend antes de qualquer persistencia relevante. Esta primeira entrega cobre o fluxo de rascunho alimentar gerado por IA/heuristica antes da criacao da pendencia de confirmacao.

## Escopo desta entrega

- Validar que o rascunho alimentar possui ao menos um item estruturado.
- Validar identidade do alimento, quantidade, unidade, porcao textual e gramas estimados.
- Validar que calorias e macronutrientes sao numericos e nao negativos.
- Permitir itens legitimamente zero caloria, como agua, cafe sem acucar e refrigerante zero.
- Validar confianca minima do item.
- Exigir `nutritionSource` rastreavel nos itens gerados pelo motor nutricional.
- Preencher fonte estimada rastreavel para rascunhos legados que ainda nao carreguem `nutritionSource`.
- Exigir que estimativas estejam marcadas com `reviewRequired` antes de virarem rascunho persistido.
- Registrar evento `meal_draft.validation_blocked` quando a validacao bloqueia o rascunho.

## Fora desta entrega

- Politica completa de autonomia da #436.
- Confirmacao/revisao de acoes destrutivas.
- Validacao de remocao, correcao e ajuste de registros existentes.
- Validacao completa de datas relativas e fuso horario.
- Validacao de midia/rotulo de baixa confianca.
- Bloqueio especifico de perguntas medicas sensiveis.
- Sucesso parcial em mensagens com multiplas acoes.

Esses pontos continuam dentro da #412 e subissues relacionadas.

## Implementacao

A validacao vive em `server/modules/meals/draftValidation.ts` e expõe:

- `validateMealDraftForPersistence`, que retorna `valid` e lista de issues;
- `assertMealDraftValidForPersistence`, que lança `MealDraftValidationError` quando o rascunho nao pode ser persistido.

O serviço `processMealDraft` normaliza/deduplica os itens, preenche `nutritionSource` estimada para itens legados sem esse campo e chama a validacao antes de `createPendingMealInference`.

## Regras atuais

O rascunho e bloqueado quando:

- nao ha itens;
- alimento ou nome canonico estao vazios;
- quantidade, porcao ou gramas sao invalidos;
- calorias/macros nao sao numeros validos ou sao negativos;
- confianca do item fica abaixo de `0.25`;
- falta fonte nutricional rastreavel apos normalizacao;
- confianca da fonte nutricional fica abaixo de `0.25`;
- a fonte e estimada, mas nao esta marcada para revisao.

## Proximos passos

A proxima fatia da #412 deve validar a confirmacao final e outros tipos de acao persistente, incluindo politica de autonomia, remocoes, correcoes, datas relativas, midia ambigua e perguntas sensiveis.
