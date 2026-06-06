# Design tecnico: pipeline de importacao de alimentos

Parent: #150
Issue: #152
Depends on: #151

## Objetivo

O pipeline permite semear e importar alimentos comuns do Brasil para o catalogo global criado na #151. A primeira versao prioriza execucao controlada, idempotencia e relatorio de conflitos antes de expandir para cargas maiores de TACO/TBCA.

## Comandos

```bash
pnpm foods:seed:common-br
pnpm foods:import:taco ./caminho/taco.csv
pnpm foods:import:tbca ./caminho/tbca.csv
```

Todos os comandos exigem `DATABASE_URL` apontando para um banco com a migration do catalogo global aplicada.

## Estrutura

| Arquivo | Papel |
|---|---|
| `scripts/import-foods/common_brazil_foods.seed.json` | Base curada inicial, pequena e segura. |
| `scripts/import-foods/seed_common_brazil_foods.ts` | Executa o seed curado. |
| `scripts/import-foods/import_taco.ts` | Adaptador CSV inicial para TACO. |
| `scripts/import-foods/import_tbca.ts` | Adaptador CSV inicial para TBCA. |
| `scripts/import-foods/run_food_import.ts` | Executor idempotente de escrita no banco. |
| `scripts/import-foods/normalize_food_name.ts` | Normalizacao de nomes e codigos de origem. |
| `scripts/import-foods/generate_aliases.ts` | Geracao basica de aliases pesquisaveis. |

## Idempotencia

- `food_sources` usa `slug` + `version` para identificar a origem.
- `foods` usa `source_id` + `source_food_code` para evitar duplicacao da mesma fonte.
- `food_aliases` usa `food_id` + `normalized_alias`.
- `food_portions` usa `food_id` + `normalized_label` + `unit`.

O executor atualiza alimentos ja importados pela mesma fonte/codigo, mas nao sobrescreve alimentos globais manuais sem `source_id` + `source_food_code` correspondente.

## Relatorio

Cada execucao imprime um JSON com:

- `inserted`
- `updated`
- `ignored`
- `aliasesInserted`
- `portionsInserted`
- `possibleDuplicates`
- `errors`

`possibleDuplicates` aponta alimentos globais com mesmo nome normalizado, mas outra fonte/codigo, para revisao de curadoria.

## Nutrientes

Os macros principais sao gravados por 100 g:

- kcal
- proteina
- carboidrato
- gordura
- fibra
- sodio

Campos adicionais da fonte sao preservados em `nutrients_json` nos importadores CSV.

## Limites desta versao

- A base curada inicial e pequena, feita para validar o pipeline antes de uma carga de 300 a 600 itens.
- Os adaptadores TACO/TBCA aceitam CSV local e nomes comuns de colunas, mas ainda podem precisar de ajuste fino conforme o formato oficial escolhido.
- A execucao ainda precisa ser validada em ambiente com clone funcional e banco migrado.
