# Alimentos personalizados por usuario

## Objetivo

Permitir que cada usuario cadastre alimentos proprios dentro do mesmo contrato do catalogo global, sem duplicar nem alterar alimentos globais. O registro personalizado usa a tabela `foods` com `owner_user_id` preenchido.

## Contrato de API

As novas procedures ficam no grupo `foods`:

- `foods.customCreate`: cria um alimento personalizado do usuario autenticado.
- `foods.customUpdate`: atualiza apenas alimento personalizado pertencente ao usuario autenticado.
- `foods.customDelete`: desativa logicamente apenas alimento personalizado pertencente ao usuario autenticado.

O contrato usa nutrientes por 100g, com macros minimos obrigatorios:

- `caloriesKcalPer100g`
- `proteinGramsPer100g`
- `carbsGramsPer100g`
- `fatGramsPer100g`

Campos opcionais incluem marca, categoria, descricao, fibras, acucar, sodio, nutrientes extras, aliases e porcoes caseiras.

## Isolamento por usuario

A busca global ja filtra alimentos por:

```sql
owner_user_id IS NULL OR owner_user_id = :userId
```

Com isso, alimentos globais continuam visiveis para todos e alimentos personalizados aparecem somente para o dono. Operacoes de update e delete verificam `id` e `owner_user_id` juntos, bloqueando alteracao de alimentos globais e de alimentos de outro usuario.

## Exclusao segura

A exclusao de alimento personalizado nao remove fisicamente o registro. A API marca `status = 'deprecated'` para preservar historico e snapshots de refeicoes que ja referenciem o alimento via `mealItems.foodId`.

Por padrao, a busca esconde itens inativos. Consultas com `includeInactive = true` podem recuperar itens depreciados quando o fluxo precisar mostrar historico ou auditoria.

## Relacao com snapshots de refeicao

Quando um alimento personalizado e usado em uma refeicao, a PR de snapshot nutricional salva uma copia dos nutrientes no item de refeicao. Assim, edicoes futuras no alimento personalizado nao alteram refeicoes antigas ja confirmadas.

## Catálogo legado usado pela IA

A base legada `foodCatalog`, consumida pela busca de alimentos e pelo resolvedor de itens da IA, também usa exclusão lógica para entradas criadas pelo usuário:

- `status = 'active'` participa de busca, recentes, favoritos e matching automático;
- `status = 'deprecated'` fica disponível somente para lookup histórico autorizado por ID;
- apenas a entrada própria do usuário autenticado pode ser depreciada;
- a depreciação e a remoção do favorito acontecem na mesma transação;
- uma identidade própria depreciada bloqueia fallback nominal para um alimento global equivalente, permitindo que a próxima classificação da IA crie uma nova entrada ativa;
- uma seleção manual explícita de um alimento global ativo continua permitida.

Refeições antigas mantêm seus snapshots e podem consultar a entrada depreciada por ID, sem recolocá-la na base ativa.

## Validacoes pendentes

Esta implementacao depende da pilha do catalogo global e deve ser validada com:

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`
- `pnpm docs:check`
- `pnpm agent:check`
