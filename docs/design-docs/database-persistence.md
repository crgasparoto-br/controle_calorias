# Design técnico: persistência e banco

## Fonte de verdade

`drizzle/schema.ts` é a fonte de verdade do modelo relacional. Migrações em `drizzle/` devem refletir mudanças de schema e ser aplicadas antes de validar fluxos em produção.

## Tabelas críticas

| Tabela | Papel |
|---|---|
| `users` | Identidade interna e papel |
| `userProfiles` | Perfil nutricional e onboarding |
| `nutritionGoals` | Metas e exceções |
| `meals` | Cabeçalho da refeição |
| `mealItems` | Itens nutricionais por refeição |
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

## Validação

- Rodar `pnpm db:check-integrity` quando houver `DATABASE_URL` disponível.
- Rodar `pnpm docs:check` após alterar schema ou docs geradas.
