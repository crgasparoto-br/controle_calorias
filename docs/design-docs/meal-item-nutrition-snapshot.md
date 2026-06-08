# Design tecnico: snapshot nutricional em itens de refeicao

Parent: #150
Issue: #155
Depends on: #151, #154

## Objetivo

Cada item de refeicao deve preservar os valores nutricionais calculados no momento do consumo. O `foodId` mantem rastreabilidade para o catalogo global, mas o historico do usuario nao deve mudar silenciosamente quando um alimento global for corrigido, depreciado ou mesclado depois.

## Campos adicionados

A migration `0001_meal_item_nutrition_snapshot.sql` adiciona a `mealItems`:

| Campo | Papel |
|---|---|
| `foodId` | Referencia opcional para `foods.id` do catalogo global/personalizado. |
| `grams` | Quantidade consumida em gramas usada no calculo. |
| `caloriesKcal` | Calorias calculadas no momento do registro. |
| `proteinG` | Proteina calculada no momento do registro. |
| `carbG` | Carboidrato calculado no momento do registro. |
| `fatG` | Gordura calculada no momento do registro. |
| `fiberG` | Fibra calculada quando disponivel. |
| `sodiumMg` | Sodio calculado quando disponivel. |
| `foodSnapshotJson` | Snapshot completo do alimento usado no calculo. |

Os campos legados `calories`, `protein`, `carbs`, `fat` continuam existindo para compatibilidade com telas e relatorios atuais.

## Fluxo de calculo

Quando um item de refeicao chega com `foodId`:

1. O backend consulta o alimento por `foods.catalogGet`, respeitando escopo do usuario.
2. Os nutrientes por 100 g sao multiplicados por `estimatedGrams / 100`.
3. O item e enriquecido com os valores calculados.
4. A refeicao e salva pelo fluxo atual.
5. O snapshot e persistido em `mealItems` nas novas colunas.

Quando um item nao tem `foodId`, o fluxo atual continua usando os valores enviados pelo rascunho/manual, sem snapshot do catalogo global.

## Estabilidade historica

`foodSnapshotJson` salva:

- data de captura;
- `foodId`;
- escopo (`global` ou `user`);
- nome, categoria, status e merge do alimento;
- fonte, versao e codigo de origem;
- nutrientes por 100 g usados;
- nutrientes calculados para a gramagem consumida.

Assim, atualizacoes futuras em `foods` nao alteram refeicoes antigas automaticamente.

## Deprecated e merged

Alimentos `deprecated` ou `merged` ainda podem ser usados em historico passado porque o snapshot preserva o estado capturado. Novos fluxos de busca podem rebaixar esses alimentos, mas nao devem reprocessar refeicoes antigas sem acao explicita de curadoria.

## Compatibilidade

Esta fatia nao faz migracao retroativa de refeicoes antigas. Registros antigos seguem exibindo os campos legados ja existentes. A migracao retroativa fica fora do escopo da #155.
