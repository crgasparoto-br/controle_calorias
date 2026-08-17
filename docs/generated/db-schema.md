# Documentação gerada: schema do banco

> Arquivo gerado automaticamente por `pnpm docs:generate:db`. Não edite manualmente.

Fontes: `drizzle/schema.ts`, `drizzle/professional-schema.ts`, `drizzle/billing-schema.ts`, `drizzle/billing-subscription-lifecycle-schema.ts` e `drizzle/usage-governance-schema.ts`.

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
| `mealItems` | `mealItems` | 28 | Requer atenção |
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
| `professionalProfiles` | `professionalProfiles` | 7 | Requer atenção |
| `professionalPatientAuthorizations` | `professionalPatientAuthorizations` | 19 | Requer atenção |
| `professionalPatientTrackings` | `professionalPatientTrackings` | 15 | Requer atenção |
| `professionalPatientTrackingEvents` | `professionalPatientTrackingEvents` | 9 | Requer atenção |
| `professionalComments` | `professionalComments` | 5 | Requer atenção |
| `professionalGoalSuggestions` | `professionalGoalSuggestions` | 13 | Requer atenção |
| `professionalMealSuggestions` | `professionalMealSuggestions` | 14 | Requer atenção |
| `professionalHistoryEvents` | `professionalHistoryEvents` | 9 | Requer atenção |
| `professionalOfficialGoals` | `professionalOfficialGoals` | 22 | Requer atenção |
| `professionalGoalReviewRequests` | `professionalGoalReviewRequests` | 11 | Requer atenção |
| `professionalGoalNotifications` | `professionalGoalNotifications` | 13 | Requer atenção |
| `professionalConversations` | `professionalConversations` | 7 | Requer atenção |
| `professionalMessages` | `professionalMessages` | 25 | Requer atenção |
| `professionalMessageDeliveryAttempts` | `professionalMessageDeliveryAttempts` | 12 | Requer atenção |
| `billingProducts` | `billingProducts` | 8 | Requer atenção |
| `billingPlans` | `billingPlans` | 22 | Requer atenção |
| `billingSubscriptions` | `billingSubscriptions` | 16 | Requer atenção |
| `billingProviderEvents` | `billingProviderEvents` | 12 | Requer atenção |
| `billingEntitlements` | `billingEntitlements` | 16 | Requer atenção |
| `billingCapacityAllocations` | `billingCapacityAllocations` | 13 | Requer atenção |
| `billingAdminOverrides` | `billingAdminOverrides` | 13 | Requer atenção |
| `billingAccessAuditEvents` | `billingAccessAuditEvents` | 10 | Requer atenção |
| `billingCoupons` | `billingCoupons` | 23 | Requer atenção |
| `billingCouponRedemptions` | `billingCouponRedemptions` | 13 | Requer atenção |
| `billingCommercialAuditEvents` | `billingCommercialAuditEvents` | 8 | Requer atenção |
| `billingContractIntents` | `billingContractIntents` | 13 | Requer atenção |
| `billingSubscriptionLifecycle` | `billingSubscriptionLifecycle` | 18 | Requer atenção |
| `billingTrialIdentityClaims` | `billingTrialIdentityClaims` | 6 | Requer atenção |
| `billingTrialEligibilityAuditEvents` | `billingTrialEligibilityAuditEvents` | 9 | Requer atenção |
| `billingSubscriptionFacts` | `billingSubscriptionFacts` | 19 | Requer atenção |
| `billingSubscriptionLifecycleAuditEvents` | `billingSubscriptionLifecycleAuditEvents` | 8 | Requer atenção |
| `billingUsageEvents` | `billingUsageEvents` | 30 | Requer atenção |
| `billingUsageDailyAggregates` | `billingUsageDailyAggregates` | 9 | Requer atenção |
| `billingEconomicFacts` | `billingEconomicFacts` | 7 | Requer atenção |
| `billingEconomicMonthlyAggregates` | `billingEconomicMonthlyAggregates` | 4 | Requer atenção |
| `billingUsagePolicies` | `billingUsagePolicies` | 5 | Requer atenção |
| `billingUsageAllowanceGrants` | `billingUsageAllowanceGrants` | 4 | Requer atenção |
| `billingUsageAbuseCases` | `billingUsageAbuseCases` | 6 | Requer atenção |
| `billingUsageLimitations` | `billingUsageLimitations` | 5 | Requer atenção |
| `billingUsageLimitationAppeals` | `billingUsageLimitationAppeals` | 4 | Requer atenção |
| `billingConsumptionChargeAuthorizations` | `billingConsumptionChargeAuthorizations` | 5 | Requer atenção |
| `billingUsageLegalHolds` | `billingUsageLegalHolds` | 3 | Requer atenção |
| `billingUsageRetentionAudit` | `billingUsageRetentionAudit` | 2 | Requer atenção |
| `billingUsageCostReconciliations` | `billingUsageCostReconciliations` | 4 | Requer atenção |

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
- `professionalProfiles` via export `professionalProfiles`.
- `professionalPatientAuthorizations` via export `professionalPatientAuthorizations`.
- `professionalPatientTrackings` via export `professionalPatientTrackings`.
- `professionalPatientTrackingEvents` via export `professionalPatientTrackingEvents`.
- `professionalComments` via export `professionalComments`.
- `professionalGoalSuggestions` via export `professionalGoalSuggestions`.
- `professionalMealSuggestions` via export `professionalMealSuggestions`.
- `professionalHistoryEvents` via export `professionalHistoryEvents`.
- `professionalOfficialGoals` via export `professionalOfficialGoals`.
- `professionalGoalReviewRequests` via export `professionalGoalReviewRequests`.
- `professionalGoalNotifications` via export `professionalGoalNotifications`.
- `professionalConversations` via export `professionalConversations`.
- `professionalMessages` via export `professionalMessages`.
- `professionalMessageDeliveryAttempts` via export `professionalMessageDeliveryAttempts`.
- `billingProducts` via export `billingProducts`.
- `billingPlans` via export `billingPlans`.
- `billingSubscriptions` via export `billingSubscriptions`.
- `billingProviderEvents` via export `billingProviderEvents`.
- `billingEntitlements` via export `billingEntitlements`.
- `billingCapacityAllocations` via export `billingCapacityAllocations`.
- `billingAdminOverrides` via export `billingAdminOverrides`.
- `billingAccessAuditEvents` via export `billingAccessAuditEvents`.
- `billingCoupons` via export `billingCoupons`.
- `billingCouponRedemptions` via export `billingCouponRedemptions`.
- `billingCommercialAuditEvents` via export `billingCommercialAuditEvents`.
- `billingContractIntents` via export `billingContractIntents`.
- `billingSubscriptionLifecycle` via export `billingSubscriptionLifecycle`.
- `billingTrialIdentityClaims` via export `billingTrialIdentityClaims`.
- `billingTrialEligibilityAuditEvents` via export `billingTrialEligibilityAuditEvents`.
- `billingSubscriptionFacts` via export `billingSubscriptionFacts`.
- `billingSubscriptionLifecycleAuditEvents` via export `billingSubscriptionLifecycleAuditEvents`.
- `billingUsageEvents` via export `billingUsageEvents`.
- `billingUsageDailyAggregates` via export `billingUsageDailyAggregates`.
- `billingEconomicFacts` via export `billingEconomicFacts`.
- `billingEconomicMonthlyAggregates` via export `billingEconomicMonthlyAggregates`.
- `billingUsagePolicies` via export `billingUsagePolicies`.
- `billingUsageAllowanceGrants` via export `billingUsageAllowanceGrants`.
- `billingUsageAbuseCases` via export `billingUsageAbuseCases`.
- `billingUsageLimitations` via export `billingUsageLimitations`.
- `billingUsageLimitationAppeals` via export `billingUsageLimitationAppeals`.
- `billingConsumptionChargeAuthorizations` via export `billingConsumptionChargeAuthorizations`.
- `billingUsageLegalHolds` via export `billingUsageLegalHolds`.
- `billingUsageRetentionAudit` via export `billingUsageRetentionAudit`.
- `billingUsageCostReconciliations` via export `billingUsageCostReconciliations`.

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
| `mealItems` | `foodName`, `canonicalName`, `portionText`, `foodSnapshotJson` |
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
| `professionalProfiles` | `displayName` |
| `professionalPatientAuthorizations` | `professionalUserId`, `patientUserId`, `reason`, `authorizationMessageStatus`, `authorizationMessageSentAt`, `authorizationMessageError` |
| `professionalPatientTrackings` | `authorizationId`, `professionalUserId`, `patientUserId`, `lastTransitionReason` |
| `professionalPatientTrackingEvents` | `authorizationId`, `actorUserId`, `reason`, `occurredAt` |
| `professionalComments` | `professionalUserId`, `patientUserId` |
| `professionalGoalSuggestions` | `professionalUserId`, `patientUserId` |
| `professionalMealSuggestions` | `professionalUserId`, `patientUserId`, `mealLabel`, `notes` |
| `professionalHistoryEvents` | `actorUserId`, `professionalUserId`, `patientUserId`, `occurredAt` |
| `professionalOfficialGoals` | `authorizationId`, `professionalUserId`, `patientUserId`, `activePatientKey`, `exceptionsJson`, `endReason` |
| `professionalGoalReviewRequests` | `professionalUserId`, `patientUserId`, `reason` |
| `professionalGoalNotifications` | `patientUserId` |
| `professionalConversations` | `authorizationId`, `professionalUserId`, `patientUserId`, `lastMessageAt` |
| `professionalMessages` | `authorizationId`, `professionalUserId`, `patientUserId`, `messageType`, `inReplyToMessageId`, `supersedesMessageId`, `providerMessageId` |
| `professionalMessageDeliveryAttempts` | `messageId`, `providerMessageId`, `errorDetail` |
| `billingProducts` | `name` |
| `billingPlans` | `name`, `entitlementsJson`, `commercialPaymentMethodsJson` |
| `billingProviderEvents` | `occurredAt`, `payloadJson` |
| `billingEntitlements` | `professionalAuthorizationId`, `entitlementsJson` |
| `billingCapacityAllocations` | `professionalUserId`, `patientUserId`, `authorizationId`, `coverageKey`, `releaseReason` |
| `billingAdminOverrides` | `reason` |
| `billingAccessAuditEvents` | `actorUserId`, `reason`, `metadataJson`, `occurredAt` |
| `billingCoupons` | `eligibleProductCodesJson`, `eligibleVersionCodesJson`, `eligibleCyclesJson` |
| `billingCommercialAuditEvents` | `actorUserId`, `reason`, `metadataJson` |
| `billingSubscriptionLifecycle` | `lastAuthoritativeOccurredAt`, `reconciliationReason` |
| `billingTrialEligibilityAuditEvents` | `reason`, `identityTypesJson` |
| `billingSubscriptionFacts` | `payloadJson` |
| `billingSubscriptionLifecycleAuditEvents` | `actorUserId`, `reason`, `metadataJson`, `occurredAt` |
| `billingUsageEvents` | `patientUserId`, `metadataJson`, `occurredAt` |
| `billingUsageDailyAggregates` | `patientUserId` |
| `billingEconomicMonthlyAggregates` | `measurementCoverageBps` |
| `billingUsageAbuseCases` | `signalsJson` |
| `billingUsageLimitations` | `operationsJson` |
| `billingConsumptionChargeAuthorizations` | `reason` |
| `billingUsageLegalHolds` | `reason` |
| `billingUsageCostReconciliations` | `usageIdempotencyKey`, `reason` |

## Relações críticas

- A maioria dos dados de domínio referencia `users.id`.
- `meals` possui `mealItems`, `mealMedia` e pode ser referenciada por `mealInferences`.
- `mealFavorites`, `foodFavorites`, `userGamificationSettings` e `userBadges` alimentam personalização e engajamento.
- `professionalPatientAuthorizations` separa consentimento de `professionalPatientTrackings`; cada transição de acompanhamento gera um evento auditável.
- Billing separa titular/pagador, beneficiário, patrocinador e origem do entitlement; coberturas profissionais não criam assinatura para o paciente.
