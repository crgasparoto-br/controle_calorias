# Design tecnico: catalogo global de alimentos

Parent: #150
Primeira fatia: #151

## Objetivo

O catalogo global separa dados de referencia do sistema de dados do usuario. Alimentos comuns do Brasil ficam disponiveis uma unica vez para todos os usuarios, enquanto alimentos personalizados continuam vinculados ao usuario dono.

## Modelo inicial

| Tabela                | Papel                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| `food_sources`        | Fonte nutricional, versao, codigo externo e metadados de origem.             |
| `foods`               | Alimentos globais e personalizados, diferenciados por `owner_user_id`.       |
| `food_aliases`        | Nomes alternativos pesquisaveis por alimento.                                |
| `food_portions`       | Porcoes e medidas caseiras associadas ao alimento.                           |
| `food_source_imports` | Historico tecnico de cada tentativa de carga, sem substituir `food_sources`. |

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

## Proveniencia e publicacao

`food_sources` preserva a referencia da origem (`source_url`/`source_reference`) e a identidade material da versao (`content_hash`). A tabela `food_source_imports` registra o processo que tentou publicar essa versao, seu periodo de coleta/importacao, resultado e contagens. Uma carga invalida ou interrompida nao publica um subconjunto: a escrita de alimentos, aliases e porcoes e transacional.

O importador atualiza somente a identidade global correspondente a fonte e ao codigo externo. Ele nao modifica `meal_items` nem reativa estados curatoriais ja definidos; os snapshots nutricionais dos lancamentos historicos permanecem a referencia de calculo.

## Nutrientes

> **Baseline físico atual:** `foods` ainda guarda nutrientes por 100 g. Na arquitetura alvo do Food Intelligence V2, identidade e nutrição serão separadas e esses valores migrarão para `food_nutrition_profiles` versionados. Não ampliar o acoplamento atual.

`foods` guarda os nutrientes principais por 100 g:

- `calories_kcal_per_100g`
- `protein_grams_per_100g`
- `carbs_grams_per_100g`
- `fat_grams_per_100g`
- `fiber_grams_per_100g`
- `sugar_grams_per_100g`
- `sodium_mg_per_100g`

Nutrientes fora desse conjunto ficam em `nutrients_json`, como campo flexivel para fontes TACO/TBCA ou curadoria interna.

## Compatibilidade e direção de consolidação

A estrutura `foods` + `food_aliases` + `food_portions` + `food_sources` continua sendo a base relacional do catálogo global. `foodCatalog`, `foodBrands`, `portions`, catálogos estáticos e outros stores alimentares legados ainda podem existir por compatibilidade com consumidores atuais, mas são **fontes transitórias**.

A arquitetura alvo está em `adr-food-intelligence-resolver-v2.md`. Até a migração:

- não ampliar o legado com novas famílias de dados quando a informação puder entrar na base governada;
- toda compatibilidade nova precisa declarar o owner futuro e a condição de aposentadoria;
- nenhum consumidor deve interpretar a coexistência como permissão para escolher arbitrariamente entre duas fontes concorrentes;
- a retirada do legado deve ser incremental e comprovada por golden flows/replay, preservando snapshots históricos de refeições.

## Fora desta fatia

- Importacao completa de TACO/TBCA.
- API de busca do catalogo.
- Integracao com registro manual ou foto.
- Snapshot nutricional em `mealItems`.
