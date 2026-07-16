# Documentação gerada: schema do banco

> Arquivo gerado automaticamente por `pnpm docs:generate:db`. Não edite manualmente.

Fonte: `drizzle/schema.ts`.

## Tabelas

| Export | Tabela física | Colunas | Classificação |
|---|---|---:|---|
| `waterGoals` | `waterGoals` | 5 | Requer atenção |

## Tabelas sensíveis conhecidas

- `waterGoals` via export `waterGoals`.

## Campos sensíveis conhecidos

| Tabela física | Campos detectados |
|---|---|

## Relações críticas

- A maioria dos dados de domínio referencia `users.id`.
- `meals` possui `mealItems`, `mealMedia` e pode ser referenciada por `mealInferences`.
- `mealFavorites`, `foodFavorites`, `userGamificationSettings` e `userBadges` alimentam personalização e engajamento.

