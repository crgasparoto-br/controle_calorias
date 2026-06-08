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

## Validacoes pendentes

Esta implementacao depende da pilha do catalogo global e deve ser validada com:

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`
- `pnpm docs:check`
- `pnpm agent:check`
