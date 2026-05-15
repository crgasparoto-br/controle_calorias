# Documentação gerada/manualizada: schema do banco

Este arquivo resume `drizzle/schema.ts` para navegação rápida por humanos e agentes. Atualize quando alterar o schema.

## Tabelas e finalidade

| Tabela | Finalidade | Sensibilidade |
|---|---|---|
| `users` | Usuários, identidade OAuth e papel | Identidade |
| `userProfiles` | Perfil nutricional, peso, objetivo, rotina e timezone | Saúde |
| `nutritionGoals` | Metas padrão e exceções | Saúde |
| `foodBrands` | Marcas de alimentos | Baixa |
| `foodCatalog` | Catálogo alimentar e macros | Média quando criado por usuário |
| `foodFavorites` | Favoritos alimentares do usuário ligados ao catálogo | Hábitos |
| `mealFavorites` | Refeições favoritas/reutilizáveis do usuário | Hábitos alimentares |
| `portions` | Porções relacionadas ao catálogo | Baixa |
| `recipes` | Receitas do usuário | Hábitos |
| `recipeItems` | Ingredientes de receitas | Hábitos |
| `meals` | Refeições e textos/transcrições associados | Saúde sensível |
| `mealItems` | Alimentos, porções e macros por refeição | Saúde sensível |
| `mealMedia` | Referências de imagem/áudio | Sensível |
| `mealInferences` | Rascunhos, IA, reasoning, sourceText e transcript | Muito sensível |
| `habitMemories` | Memória de hábitos alimentares | Saúde sensível |
| `dailySummaries` | Totais diários consolidados | Saúde |
| `exercises` | Atividades físicas | Saúde |
| `weightEntries` | Pesos medidos | Saúde sensível |
| `waterGoals` | Meta de hidratação | Saúde |
| `waterLogs` | Consumo de água | Saúde |
| `userPreferences` | Preferências por chave | Depende da chave |
| `userRestrictions` | Alergias, restrições e condições | Saúde sensível |
| `userGamificationSettings` | Preferências e estado de gamificação do usuário | Preferências/comportamento |
| `userBadges` | Medalhas e conquistas obtidas pelo usuário | Comportamento |
| `whatsappConnections` | Telefone do usuário e status de vínculo | Identidade sensível |
| `appSecrets` | Segredos criptografados | Segredo operacional |
| `inferenceLogs` | Eventos de inferência sanitizados | Operacional |

## Relações críticas

- A maioria dos dados de domínio referencia `users.id`.
- `meals` possui `mealItems` e `mealMedia` por `mealId`.
- `mealInferences` referencia `users` e opcionalmente `meals`.
- `mealFavorites`, `userGamificationSettings` e `userBadges` referenciam `users.id` e alimentam personalização/engajamento.
- `whatsappConnections.phoneNumber` identifica o usuário final no canal WhatsApp.

## Campos que exigem cuidado extra

`sourceText`, `transcript`, `reasoning`, `mediaJson`, `storageUrl`, `phoneNumber`, `valueEncrypted`, `detail`, peso, restrições, objetivos, histórico alimentar, favoritos e sinais de comportamento.
