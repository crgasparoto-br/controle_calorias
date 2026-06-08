# Design tecnico: sinais de uso e curadoria do catalogo global

Parent: #150
Issues: #161, #162, #163

## Escopo entregue

Esta fatia completa o catalogo global com tres capacidades que faltavam para encerrar a issue mae:

- favoritos por usuario para alimentos do novo catalogo (`foods`);
- ranking e listagem de recentes baseada em uso real em refeicoes;
- curadoria administrativa minima para status `active`, `deprecated` e `merged`.

## Modelo de dados

Foram adicionadas duas tabelas ao novo catalogo:

- `user_food_favorites`: relacao unica `user_id + food_id` para favoritos.
- `user_food_usage_stats`: relacao unica `user_id + food_id` com `usage_count` e `last_used_at`.

Essas tabelas referenciam `foods`, nao o catalogo legado `foodCatalog`. Isso evita misturar os dois modelos durante a transicao.

## Fluxo de uso recente

Quando uma refeicao recebe um item com `foodId`, o backend resolve porcao/nutrientes, grava o snapshot nutricional e registra o uso do alimento em `user_food_usage_stats`.

A listagem `foods.catalogRecent` retorna apenas alimentos `active` acessiveis ao usuario, ordenados por `last_used_at` e depois por frequencia.

## Favoritos

`foods.catalogFavorite` valida se o alimento existe e esta acessivel para o usuario antes de gravar/remover favorito. A resposta reaproveita o contrato de `catalogGet`, incluindo `userSignals.favorite` atualizado.

## Curadoria

`admin.curateGlobalFood` aceita somente alimentos globais. Para `merged`, o destino tambem precisa ser global e diferente do item curado.

A busca padrao continua retornando apenas `active`. Quando `includeInactive` e usado, `deprecated` e `merged` aparecem rebaixados no ranking.

## Validacao recomendada

- `pnpm check`
- `pnpm test -- server/modules/foods/catalogService.test.ts server/modules/foods/portionConversion.test.ts`
- `pnpm test`
- `pnpm architecture:check`

Como a alteracao inclui migration, tambem validar aplicacao de `drizzle/0002_global_food_catalog_user_signals.sql` em ambiente de homologacao antes do deploy definitivo.
