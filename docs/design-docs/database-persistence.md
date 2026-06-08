# Design técnico: persistência e banco

## Fonte de verdade

`drizzle/schema.ts` é a fonte de verdade do modelo relacional. Migrações em `drizzle/` devem refletir mudanças de schema e ser aplicadas antes de validar fluxos em produção.

## Tabelas críticas

| Tabela | Papel |
|---|---|
| `users` | Identidade interna e papel |
| `userProfiles` | Perfil nutricional e onboarding |
| `nutritionGoals` | Metas e exceções |
| `food_sources` | Fontes nutricionais, versão e código de origem do catálogo global |
| `foods` | Catálogo alimentar global e alimentos personalizados por usuário |
| `food_aliases` | Nomes alternativos normalizados para busca no catálogo |
| `food_portions` | Porções e medidas caseiras por alimento do catálogo |
| `meals` | Cabeçalho da refeição |
| `mealItems` | Itens nutricionais por refeição, incluindo snapshot nutricional histórico |
| `mealMedia` | Referências de mídia |
| `mealInferences` | Rascunhos e inferências de IA |
| `habitMemories` | Memória de hábitos alimentares |
| `whatsappConnections` | Vínculo telefone do usuário ↔ usuário interno |
| `inferenceLogs` | Logs seguros de inferência |
| `appSecrets` | Segredos operacionais criptografados |

## Regras

- Toda FK de dados do usuário deve preservar isolamento por `userId`.
- Exclusão de usuário deve apagar dados dependentes sempre que a relação tiver `onDelete: cascade`.
- Dados sensíveis textuais devem ter política explícita de retenção antes de novos usos.
- `server/db.ts` ainda concentra funções legadas; novas áreas devem preferir repositories por domínio.
- Alimentos globais usam `foods.owner_user_id = null` e devem ser visíveis para todos os usuários.
- Alimentos personalizados usam `foods.owner_user_id = <user_id>` e devem ser filtrados pelo usuário dono.
- Refeições futuras devem salvar consumo real em itens de refeição com snapshot nutricional, sem duplicar dados globais do catálogo.
- Alterações futuras em `foods` não devem recalcular refeições antigas silenciosamente.

## Catálogo global de alimentos

A migration `0000_global_food_catalog.sql` cria a primeira estrutura dedicada ao catálogo alimentar global:

- `food_sources` registra fonte, versão e metadados de origem, como TACO/TBCA ou curadoria interna.
- `foods` concentra alimentos globais e personalizados, com nutrientes principais por 100 g, `nutrients_json`, `status` e `merged_into_food_id`.
- `food_aliases` permite busca por nomes alternativos normalizados.
- `food_portions` registra porções e medidas caseiras ligadas ao alimento.

A estratégia inicial contra duplicidade usa `foods_source_code_unique` para impedir repetição de `source_id` + `source_food_code` quando a fonte disponibiliza código estável.

## Snapshot nutricional de refeições

A migration `0001_meal_item_nutrition_snapshot.sql` adiciona em `mealItems` os campos `foodId`, `grams`, macros calculados, `fiberG`, `sodiumMg` e `foodSnapshotJson`.

Quando um item é registrado com `foodId`, o backend calcula os nutrientes a partir dos valores por 100 g do catálogo e da gramagem consumida. O snapshot grava nome, fonte, versão, status e nutrientes usados no cálculo para preservar o histórico mesmo se o alimento global for corrigido, depreciado ou mesclado depois.

## Validação

- Rodar `pnpm db:check-integrity` quando houver `DATABASE_URL` disponível.
- Rodar `pnpm docs:check` após alterar schema ou docs geradas.
