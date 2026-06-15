# Selecao deterministica de fonte nutricional

## Contexto

A issue #405, subissue da #404, define como escolher a melhor fonte nutricional para alimentos informados pelo usuario. Esta entrega cria o primeiro contrato deterministico e testavel de selecao de fonte, sem implementar busca online completa (#407), validacao final antes de salvar (#412) ou comparacao futura de divergencias (#435).

## Escopo desta entrega

- Definir tipos de fonte nutricional e ordem de prioridade.
- Selecionar candidato com base em alimento, marca, variacao critica e unidade.
- Rejeitar fonte especifica incompatível com variacoes criticas, como `zero` versus `tradicional`.
- Permitir fallback estimado quando nao houver fonte especifica segura.
- Retornar qualidade, confianca, origem, versao, data de revisao, indicacao de estimativa e motivos da decisao.
- Adaptar itens do catalogo estatico e estimativas internas para o contrato do seletor.

## Hierarquia inicial

O modulo `server/nutritionSourceSelection.ts` pontua candidatos nesta ordem base:

1. `manufacturer_label`
2. `curated_catalog`
3. `official_database`
4. `internal_catalog`
5. `similar_product`
6. `generic_estimate`
7. `llm_estimate`

Essa pontuacao e ajustada por correspondencia de nome, marca, variacao, unidade e confianca informada pela fonte.

## Adaptador de metadados

O modulo `server/nutritionSourceMetadata.ts` cria candidatos rastreaveis a partir de duas origens ja usadas pelo motor nutricional:

- itens de catalogo, tratados como `curated_catalog` quando parecem produto de marca conhecido ou `internal_catalog` quando sao genericos;
- estimativas internas, tratadas como `generic_estimate` ou `llm_estimate`.

A saida adiciona `selectedAt`, mantendo a decisao pronta para ser anexada futuramente ao `MealDraftItem` e depois persistida pelo fluxo de confirmacao.

## Variacoes criticas

As variacoes abaixo influenciam diretamente a selecao:

- zero;
- sem acucar;
- diet;
- light;
- integral;
- desnatado;
- tradicional.

Quando o usuario informa uma dessas variacoes, uma fonte especifica com variacao conflitante e rejeitada. Exemplo: `Coca-Cola tradicional lata` nao deve cobrir `Coca-Cola zero lata`.

Uma fonte `generic_estimate` ou `llm_estimate` ainda pode ser usada como fallback, desde que marcada como estimativa e com revisao requerida.

## Saida do seletor

A selecao retorna:

- `candidate`: fonte escolhida ou `null`;
- `quality`: `exact`, `similar`, `generic`, `estimated` ou `needs_review`;
- `confidence`: confianca normalizada;
- `isEstimate`: indica estimativa ou aproximacao;
- `reviewRequired`: indica necessidade de revisao;
- `reasons`: motivos objetivos da decisao;
- `source`: tipo, nome, versao e data de revisao da fonte.

## Caminho de integracao

A proxima etapa deve anexar `NutritionSourceMetadata` ao fluxo de montagem do rascunho alimentar, hoje concentrado em `server/nutritionEngine.ts`, mantendo o campo legado `source` para compatibilidade.

Depois disso, #412 deve garantir que esses metadados sejam persistidos junto ao registro confirmado, e #435 podera comparar estimativas antigas com fontes confirmadas posteriormente.
