# Design tecnico: pipeline de importacao de alimentos

> **Baseline produtivo transitório.** Os comandos e tabelas abaixo descrevem o importador V1 atualmente executável. O alvo do Food Intelligence V2 está em `adr-food-intelligence-resolver-v2.md`. Novas extensões não devem consolidar macros em `foods` nem acoplar aliases/porções à família quando o dado pertence à variante.

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

| Arquivo                                              | Papel                                      |
| ---------------------------------------------------- | ------------------------------------------ |
| `scripts/import-foods/common_brazil_foods.seed.json` | Base curada inicial, pequena e segura.     |
| `scripts/import-foods/seed_common_brazil_foods.ts`   | Executa o seed curado.                     |
| `scripts/import-foods/import_taco.ts`                | Adaptador CSV inicial para TACO.           |
| `scripts/import-foods/import_tbca.ts`                | Adaptador CSV inicial para TBCA.           |
| `scripts/import-foods/run_food_import.ts`            | Executor idempotente de escrita no banco.  |
| `scripts/import-foods/normalize_food_name.ts`        | Normalizacao de nomes e codigos de origem. |
| `scripts/import-foods/generate_aliases.ts`           | Geracao basica de aliases pesquisaveis.    |

## Idempotencia

- `food_sources` usa `slug` + `version` para identificar a origem.
- `foods` usa `source_id` + `source_food_code` para evitar duplicacao da mesma fonte.
- `food_aliases` usa `food_id` + `normalized_alias`.
- `food_portions` usa `food_id` + `normalized_label` + `unit`.

O executor atualiza alimentos ja importados pela mesma fonte/codigo, mas nao sobrescreve alimentos globais manuais sem `source_id` + `source_food_code` correspondente.

## Governanca de fonte e carga (#1200)

- `food_sources` continua sendo a unica identidade canonica de origem. `source_reference` registra uma referencia humana quando nao houver URL e `content_hash` fixa a identidade material da combinacao `slug` + `version`.
- `food_source_imports` registra cada tentativa administrativa, com fonte, hash, processo executor, data de coleta, inicio/fim, estado (`running`, `succeeded`, `warning` ou `failed`), contagens e um resumo tecnico sem conteudo bruto.
- Uma mesma fonte/versao com hash diferente e rejeitada; uma nova versao precisa ser publicada explicitamente como nova carga.
- A validacao da carga ocorre antes da transacao de alimentos. Todos os upserts de `foods`, aliases e porcoes usam uma unica transacao, portanto erro ou interrupcao faz rollback do conjunto inteiro.
- A reimportacao identica mantem a chave `source_id` + `source_food_code` e as chaves unicas de aliases/porcoes; estados curatoriais existentes (`deprecated`/`merged`) nao sao reativados silenciosamente.
- O executor nao escreve em `meals` ou `meal_items`; alteracoes no catalogo nao recalculam o snapshot nutricional historico.

## Relatorio

Cada execucao imprime um JSON com:

- `inserted`
- `updated`
- `ignored`
- `aliasesInserted`
- `portionsInserted`
- `possibleDuplicates`
- `errors`
- `sourceContentHash`
- `importId`

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


## Destino no Food Intelligence V2

A migração do importador deve preservar a semântica de idempotência e governança de fonte, mas trocar os destinos físicos:

- `food_sources` e `food_source_imports` continuam representando fonte e execução da carga;
- família canônica vai para `foods`;
- identidade concreta importada vai para `food_variants`;
- `source_id + source_food_code` migra para `food_variant_sources`;
- macros/nutrientes migram para `food_nutrition_profiles`;
- classificação, quando a fonte a fornecer, migra para `food_variant_classifications`;
- aliases globais apontam para a variante;
- porções importadas apontam para a variante em `food_portions`;
- a reimportação da mesma fonte/versão não sobrescreve silenciosamente perfil nutricional já verificado; mudança material gera nova versão/perfil conforme a política do ADR.

Até o cutover, o executor V1 continua válido operacionalmente. Depois que a leitura V2 estiver ativa e reconciliada, novas escritas nos destinos V1 devem ser bloqueadas e o bridge removido.


## Limites desta versao

- A base curada inicial e pequena, feita para validar o pipeline antes de uma carga de 300 a 600 itens.
- Os adaptadores TACO/TBCA aceitam CSV local e nomes comuns de colunas, mas ainda podem precisar de ajuste fino conforme o formato oficial escolhido.
- A execucao ainda precisa ser validada em ambiente com clone funcional e banco migrado.
