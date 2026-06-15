# Fonte nutricional online controlada

## Contexto

A issue #407 pede que produtos industrializados com marca tentem obter uma tabela nutricional especifica e rastreavel antes de cair em alimento generico ou estimativa. Esta entrega cria o contrato inicial: decidir quando vale buscar uma fonte online, avaliar se um candidato encontrado pode ser usado, aplicar candidatos aceitos ao rascunho nutricional e cair em fallback seguro quando necessario.

A busca externa efetiva ainda nao e executada nesta fatia. O objetivo aqui e impedir que uma futura integracao com conectores online salve dados fracos como fonte exata.

## Modulos

O modulo `server/nutritionOnlineSource.ts` define:

- `shouldRequestOnlineNutritionSource`: identifica produto com marca, variacao critica ou embalagem/unidade especifica;
- `evaluateOnlineNutritionSourceCandidate`: avalia um candidato retornado por fonte online permitida;
- `selectOnlineNutritionSourceCandidate`: escolhe primeiro uma fonte aceita, depois uma fonte revisavel, ou fallback seguro.

O modulo `server/nutritionOnlineSourceIntegration.ts` aplica candidatos aceitos a itens ja inferidos:

- substitui nome canonico pela fonte especifica;
- recalcula calorias e macros pela quantidade do item quando a porcao e segura;
- anexa `nutritionSource` com origem, tipo, versao, confianca e `selectedAt`;
- preserva o item original quando a fonte exige revisao, tem variacao conflitante ou nao permite conversao segura.

O motor `server/nutritionEngine.ts` aceita `onlineNutritionSourceCandidates` como entrada opcional. Quando a lista nao e enviada, o comportamento existente permanece inalterado.

## Fontes permitidas

A primeira lista de origens mapeia fontes online para os tipos usados pelo seletor de #405:

1. `manufacturer` e `official_label` viram `manufacturer_label`;
2. `curated_database` vira `curated_catalog`;
3. `trusted_retailer` vira `trusted_retailer` e sempre requer revisao;
4. `community_database` vira `community_database` e sempre requer revisao;
5. `unknown` e rejeitada.

Toda fonte online precisa ter URL HTTPS rastreavel. Candidato sem URL rastreavel e rejeitado.

## Decisao de busca

A busca online so deve ser solicitada quando houver:

- marca informada;
- nome de produto;
- variacao critica, como `zero`, `light`, `integral`, `desnatado` ou `tradicional`; ou embalagem/unidade especifica, como lata, garrafa, pacote, ml ou g.

Entradas genericas sem marca continuam no fluxo normal de fonte curada, catalogo interno ou estimativa.

## Avaliacao do candidato

O candidato online e convertido para o contrato de `selectNutritionSource`, preservando:

- nome;
- marca;
- tipo de fonte;
- URL/origem externa no candidato;
- versao;
- data de consulta;
- porcao;
- macros por porcao;
- confianca.

A selecao compara marca, produto, variacao critica e unidade. Variacao conflitante, como usar `tradicional` para uma entrada `zero`, e rejeitada.

## Porcao e conversao

A conversao e considerada segura quando:

- a entrada nao informa unidade;
- a entrada usa `porcao`;
- a unidade informada bate exatamente com a porcao da fonte;
- ambas as unidades pertencem a mesma familia metrica, como g/kg/mg ou ml/l.

Quando a porcao nao e convertivel com seguranca, o candidato fica como `needs_review` e nao deve ser salvo como exato automaticamente.

## Fallback seguro

Se nao houver candidatos, se todos forem rejeitados, ou se a busca online nao for necessaria, a funcao retorna `fallback_safe`. O fluxo chamador deve entao continuar com a hierarquia de #405: catalogo curado, base oficial, similar, generico ou estimativa marcada.

## Estado de integracao

Esta fatia ainda nao chama internet nem conector externo. A proxima fatia deve implementar um provedor controlado que retorne `OnlineNutritionSourceCandidate[]` para o motor, respeitando limites de latencia, cache e allowlist.
