# Integracao da analise por foto ao catalogo global

## Objetivo

Fazer com que sugestoes geradas por foto sejam vinculadas ao catalogo global de alimentos quando houver correspondencia confiavel, sem criar novos alimentos globais automaticamente.

## Fluxo

```text
foto -> IA detecta itens -> backend busca candidatos no catalogo -> usuario revisa/troca -> confirmacao salva meal_items com snapshot
```

## Comportamento implementado

Para cada item detectado pela IA:

- o backend consulta `foods.catalogSearch` com o nome canonico inferido;
- retorna ate 3 candidatos em `catalogCandidates`;
- calcula uma confianca simples com base na proximidade textual entre item detectado e alimento do catalogo;
- quando ha candidato, o item editavel recebe `foodId`, `canonicalName` do catalogo e `source = catalog`;
- os macros da sugestao sao recalculados pela referencia por 100 g do candidato selecionado;
- alternativas ficam disponiveis no payload para futura UI mais explicita.

## Confirmacao

Na confirmacao da foto, o fluxo agora passa pelo servico de refeicoes (`confirmMeal`). Isso reaproveita a preparacao de itens, conversao de porcao/gramas e persistencia de snapshot nutricional ja implementadas na pilha do catalogo.

## Nao criacao automatica

A analise por foto nunca cria alimento global. Quando nao ha candidato adequado, o item continua como `heuristic` e pode ser revisado manualmente pelo usuario antes de salvar.

## Compatibilidade

O componente de revisao ja usa o mesmo `MealItemEditor` do fluxo manual. Com isso, itens com `foodId` aparecem como itens de catalogo e o usuario pode trocar a busca antes de confirmar.

## Validacoes pendentes

Esta PR precisa ser validada com:

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`
- `pnpm docs:check`
- `pnpm agent:check`

Validacao funcional recomendada:

- enviar foto com alimento comum como arroz/feijao/frango;
- verificar se a resposta retorna `catalogCandidates`;
- confirmar que o item editavel recebe `foodId` quando ha candidato;
- trocar o alimento sugerido antes de salvar;
- confirmar a refeicao e validar snapshot nutricional em `mealItems`.
