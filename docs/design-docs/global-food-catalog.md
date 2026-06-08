# Design tecnico: catalogo global de alimentos

Parent: #150
Primeira fatia: #151

## Objetivo

O catalogo global separa dados de referencia do sistema de dados do usuario. Alimentos comuns do Brasil ficam disponiveis uma unica vez para todos os usuarios, enquanto alimentos personalizados continuam vinculados ao usuario dono.

## Modelo inicial

| Tabela | Papel |
|---|---|
| `food_sources` | Fonte nutricional, versao, codigo externo e metadados de origem. |
| `foods` | Alimentos globais e personalizados, diferenciados por `owner_user_id`. |
| `food_aliases` | Nomes alternativos pesquisaveis por alimento. |
| `food_portions` | Porcoes e medidas caseiras associadas ao alimento. |

A regra de escopo e:

```text
foods.owner_user_id = null      => alimento global visivel para todos
foods.owner_user_id = <user_id> => alimento personalizado do usuario
```

## Integridade e duplicidade

- `foods_source_code_unique` evita duplicidade quando a combinacao `source_id` + `source_food_code` estiver disponivel.
- `food_aliases_food_alias_unique` evita repetir o mesmo alias normalizado para um alimento.
- `food_portions_food_label_unit_unique` evita porcoes repetidas por alimento, label normalizado e unidade.
- Indices por `owner_user_id`, `normalized_name` e `status` preparam busca por alimentos globais, personalizados e ativos.

## Nutrientes

`foods` guarda os nutrientes principais por 100 g:

- `calories_kcal_per_100g`
- `protein_grams_per_100g`
- `carbs_grams_per_100g`
- `fat_grams_per_100g`
- `fiber_grams_per_100g`
- `sugar_grams_per_100g`
- `sodium_mg_per_100g`

Nutrientes fora desse conjunto ficam em `nutrients_json`, como campo flexivel para fontes TACO/TBCA ou curadoria interna.

## Compatibilidade

Esta primeira fatia adiciona a estrutura nova sem remover `foodCatalog`, `foodBrands`, `portions` ou relacoes atuais. As proximas subissues devem migrar APIs e fluxos de forma incremental para evitar regressao no registro de refeicoes.

## Fora desta fatia

- Importacao completa de TACO/TBCA.
- API de busca do catalogo.
- Integracao com registro manual ou foto.
- Snapshot nutricional em `mealItems`.