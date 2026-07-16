# Documentação gerada: schema do banco

> Arquivo gerado automaticamente por `pnpm docs:generate:db`. Não edite manualmente.

Fonte: `drizzle/schema.ts`.

## Tabelas

| Export | Tabela física | Colunas | Classificação |
|---|---|---:|---|
| `users` | `users` | 10 | Requer atenção |
| `userProfiles` | `userProfiles` | 18 | Requer atenção |
| `nutritionGoals` | `nutritionGoals` | 14 | Requer atenção |
| `foodBrands` | `foodBrands` | 7 | Baixa |
| `foodSources` | `food_sources` | 9 | Baixa |
| `foods` | `foods` | 21 | Baixa |
| `foodAliases` | `food_aliases` | 6 | Baixa |
| `foodPortions` | `food_portions` | 12 | Baixa |
| `foodCatalog` | `foodCatalog` | 28 | Requer atenção |
| `foodFavorites` | `foodFavorites` | 4 | Requer atenção |
| `userGamificationSettings` | `userGamificationSettings` | 5 | Requer atenção |
| `userBadges` | `userBadges` | 6 | Requer atenção |
| `portions` | `portions` | 9 | Baixa |
| `recipes` | `recipes` | 13 | Requer atenção |
| `recipeItems` | `recipeItems` | 13 | Requer atenção |
| `meals` | `meals` | 12 | Requer atenção |
| `mealItems` | `mealItems` | 19 | Requer atenção |
| `mealMedia` | `mealMedia` | 8 | Requer atenção |
| `mealFavorites` | `mealFavorites` | 7 | Requer atenção |
| `mealInferences` | `mealInferences` | 14 | Requer atenção |
| `habitMemories` | `habitMemories` | 10 | Requer atenção |
| `dailySummaries` | `dailySummaries` | 9 | Baixa |
| `exercises` | `exercises` | 11 | Requer atenção |
| `healthSyncedRecords` | `healthSyncedRecords` | 13 | Baixa |
| `weightEntries` | `weightEntries` | 7 | Requer atenção |
| `waterGoals` | `waterGoals` | 5 | Requer atenção |
| `waterLogs` | `waterLogs` | 6 | Requer atenção |
| `userPreferences` | `userPreferences` | 6 | Requer atenção |
| `userRestrictions` | `userRestrictions` | 8 | Requer atenção |
| `whatsappConnections` | `whatsappConnections` | 7 | Requer atenção |
| `whatsappConversations` | `whatsappConversations` | 11 | Requer atenção |
| `whatsappConversationMessages` | `whatsappConversationMessages` | 23 | Requer atenção |
| `whatsappMessageDomainLinks` | `whatsappMessageDomainLinks` | 8 | Requer atenção |
| `whatsappConversationSummaries` | `whatsappConversationSummaries` | 9 | Requer atenção |
| `whatsappPendingOperations` | `whatsappPendingOperations` | 11 | Requer atenção |
| `appSecrets` | `appSecrets` | 6 | Baixa |
| `inferenceLogs` | `inferenceLogs` | 7 | Requer atenção |
| `quickEditTokens` | `quickEditTokens` | 9 | Baixa |

## Tabelas sensíveis conhecidas

- `users` via export `users`.
- `userProfiles` via export `userProfiles`.
- `nutritionGoals` via export `nutritionGoals`.
- `foodCatalog` via export `foodCatalog`.
- `foodFavorites` via export `foodFavorites`.
- `userGamificationSettings` via export `userGamificationSettings`.
- `userBadges` via export `userBadges`.
- `recipes` via export `recipes`.
- `recipeItems` via export `recipeItems`.
- `meals` via export `meals`.
- `mealItems` via export `mealItems`.
- `mealMedia` via export `mealMedia`.
- `mealFavorites` via export `mealFavorites`.
- `mealInferences` via export `mealInferences`.
- `habitMemories` via export `habitMemories`.
- `exercises` via export `exercises`.
- `weightEntries` via export `weightEntries`.
- `waterGoals` via export `waterGoals`.
- `waterLogs` via export `waterLogs`.
- `userPreferences` via export `userPreferences`.
- `userRestrictions` via export `userRestrictions`.
- `whatsappConnections` via export `whatsappConnections`.
- `whatsappConversations` via export `whatsappConversations`.
- `whatsappConversationMessages` via export `whatsappConversationMessages`.
- `whatsappMessageDomainLinks` via export `whatsappMessageDomainLinks`.
- `whatsappConversationSummaries` via export `whatsappConversationSummaries`.
- `whatsappPendingOperations` via export `whatsappPendingOperations`.
- `inferenceLogs` via export `inferenceLogs`.

## Campos sensíveis conhecidos

| Tabela física | Campos detectados |
|---|---|
| `users` | `name`, `email` |
| `userProfiles` | `displayName`, `ageYears`, `birthDate`, `heightCm`, `currentWeightKg`, `nutritionObjective`, `activityLevel`, `eatingRoutine`, `mainDifficulty`, `timezone` |
| `foodBrands` | `name`, `normalizedName` |
| `food_sources` | `name`, `source_url`, `notes` |
| `foods` | `name`, `normalized_name`, `brand_name`, `nutrients_json` |
| `food_portions` | `label`, `normalized_label` |
| `foodCatalog` | `name`, `brandName`, `servingLabel` |
| `userBadges` | `metadataJson` |
| `portions` | `label` |
| `recipes` | `name` |
| `recipeItems` | `notes` |
| `meals` | `mealLabel`, `notes`, `sourceText`, `transcript`, `occurredAt` |
| `mealItems` | `foodName`, `canonicalName`, `portionText` |
| `mealMedia` | `mediaType`, `storageKey`, `storageUrl`, `originalFileName` |
| `mealFavorites` | `name`, `mealLabel`, `notes`, `itemsJson` |
| `mealInferences` | `sourceText`, `transcript`, `mediaJson`, `reasoning`, `itemsJson`, `totalsJson` |
| `habitMemories` | `foodName`, `typicalMealLabel`, `notes` |
| `exercises` | `activityType`, `notes`, `occurredAt` |
| `healthSyncedRecords` | `measuredAt`, `activityType`, `metadataJson` |
| `weightEntries` | `weightKg`, `measuredAt`, `notes` |
| `waterLogs` | `occurredAt` |
| `userPreferences` | `preferenceKey`, `preferenceValue` |
| `userRestrictions` | `restrictionType`, `label`, `severity`, `notes` |
| `whatsappConnections` | `displayName` |
| `whatsappConversations` | `lastActivityAt` |
| `whatsappConversationMessages` | `externalMessageId`, `rawTextStored`, `text`, `sanitizedText`, `transcript`, `sanitizedTranscript`, `mediaStorageKey`, `mediaMimeType`, `captionText`, `respondsToMessageId`, `occurredAt` |
| `whatsappMessageDomainLinks` | `messageId`, `weightEntryId` |
| `whatsappConversationSummaries` | `summaryText`, `fromMessageId`, `toMessageId` |
| `inferenceLogs` | `detail` |

## Relações críticas

- A maioria dos dados de domínio referencia `users.id`.
- `meals` possui `mealItems`, `mealMedia` e pode ser referenciada por `mealInferences`.
- `mealFavorites`, `foodFavorites`, `userGamificationSettings` e `userBadges` alimentam personalização e engajamento.

