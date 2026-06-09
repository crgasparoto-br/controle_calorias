import { type AnyMySqlColumn, double, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: text("passwordHash"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, table => ({
  emailUniqueIdx: uniqueIndex("users_email_unique_idx").on(table.email),
}));

export const userProfiles = mysqlTable("userProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("displayName", { length: 255 }),
  ageYears: int("ageYears"),
  birthDate: varchar("birthDate", { length: 10 }),
  sex: mysqlEnum("sex", ["female", "male", "non_binary", "prefer_not_to_say"]).default("prefer_not_to_say").notNull(),
  heightCm: double("heightCm"),
  currentWeightKg: double("currentWeightKg"),
  nutritionObjective: mysqlEnum("nutritionObjective", ["emagrecer", "manter_peso", "ganhar_massa", "melhorar_habitos"]),
  activityLevel: mysqlEnum("activityLevel", ["sedentary", "light", "moderate", "active", "very_active"]),
  trackingExperience: mysqlEnum("trackingExperience", ["beginner", "intermediate", "advanced"]),
  eatingRoutine: mysqlEnum("eatingRoutine", ["cozinha_em_casa", "come_fora", "delivery", "marmita", "misto"]),
  mainDifficulty: mysqlEnum("mainDifficulty", ["fome", "ansiedade", "falta_de_tempo", "beliscos", "doces", "comer_fora", "falta_de_planejamento"]),
  onboardingCompletedAt: timestamp("onboardingCompletedAt"),
  timezone: varchar("timezone", { length: 80 }).default("UTC").notNull(),
  locale: varchar("locale", { length: 16 }).default("pt-BR").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index("userProfiles_userId_idx").on(table.userId),
}));

export const nutritionGoals = mysqlTable(
  "nutritionGoals",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    ruleType: mysqlEnum("ruleType", ["default", "exception"]).default("default").notNull(),
    weekday: int("weekday").default(-1).notNull(),
    durationType: mysqlEnum("durationType", ["1_week", "2_weeks", "3_weeks", "always"]).default("always").notNull(),
    calories: int("calories").notNull(),
    proteinGrams: double("proteinGrams").notNull(),
    carbsGrams: double("carbsGrams").notNull(),
    fatGrams: double("fatGrams").notNull(),
    effectiveFrom: timestamp("effectiveFrom").defaultNow().notNull(),
    effectiveUntil: timestamp("effectiveUntil"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("nutritionGoals_userId_idx").on(table.userId),
    userRuleWindowUnique: uniqueIndex("nutritionGoals_user_rule_window_idx").on(table.userId, table.ruleType, table.weekday, table.effectiveFrom),
  }),
);

export const foodBrands = mysqlTable("foodBrands", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  normalizedName: varchar("normalizedName", { length: 255 }).notNull().unique(),
  countryCode: varchar("countryCode", { length: 2 }),
  website: varchar("website", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  normalizedNameIdx: index("foodBrands_normalizedName_idx").on(table.normalizedName),
}));

export const foodSources = mysqlTable("food_sources", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  version: varchar("version", { length: 80 }).notNull(),
  countryCode: varchar("country_code", { length: 2 }),
  sourceUrl: varchar("source_url", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  slugIdx: index("food_sources_slug_idx").on(table.slug),
  slugVersionUnique: uniqueIndex("food_sources_slug_version_unique").on(table.slug, table.version),
}));

export const foods = mysqlTable("foods", {
  id: int("id").autoincrement().primaryKey(),
  ownerUserId: int("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  sourceId: int("source_id").references(() => foodSources.id, { onDelete: "set null" }),
  sourceFoodCode: varchar("source_food_code", { length: 120 }),
  name: varchar("name", { length: 255 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 255 }).notNull(),
  brandName: varchar("brand_name", { length: 255 }),
  category: varchar("category", { length: 160 }),
  description: text("description"),
  status: mysqlEnum("status", ["active", "deprecated", "merged"]).default("active").notNull(),
  mergedIntoFoodId: int("merged_into_food_id").references((): AnyMySqlColumn => foods.id, { onDelete: "set null" }),
  caloriesKcalPer100g: double("calories_kcal_per_100g").notNull(),
  proteinGramsPer100g: double("protein_grams_per_100g").notNull(),
  carbsGramsPer100g: double("carbs_grams_per_100g").notNull(),
  fatGramsPer100g: double("fat_grams_per_100g").notNull(),
  fiberGramsPer100g: double("fiber_grams_per_100g"),
  sugarGramsPer100g: double("sugar_grams_per_100g"),
  sodiumMgPer100g: double("sodium_mg_per_100g"),
  nutrientsJson: text("nutrients_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  ownerUserIdIdx: index("foods_owner_user_id_idx").on(table.ownerUserId),
  normalizedNameIdx: index("foods_normalized_name_idx").on(table.normalizedName),
  scopeSearchIdx: index("foods_scope_search_idx").on(table.ownerUserId, table.normalizedName),
  statusIdx: index("foods_status_idx").on(table.status),
  mergedIntoFoodIdIdx: index("foods_merged_into_food_id_idx").on(table.mergedIntoFoodId),
  sourceCodeUnique: uniqueIndex("foods_source_code_unique").on(table.sourceId, table.sourceFoodCode),
}));

export const foodAliases = mysqlTable("food_aliases", {
  id: int("id").autoincrement().primaryKey(),
  foodId: int("food_id").notNull().references(() => foods.id, { onDelete: "cascade" }),
  alias: varchar("alias", { length: 255 }).notNull(),
  normalizedAlias: varchar("normalized_alias", { length: 255 }).notNull(),
  sourceId: int("source_id").references(() => foodSources.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({
  normalizedAliasIdx: index("food_aliases_normalized_alias_idx").on(table.normalizedAlias),
  sourceIdIdx: index("food_aliases_source_id_idx").on(table.sourceId),
  foodAliasUnique: uniqueIndex("food_aliases_food_alias_unique").on(table.foodId, table.normalizedAlias),
}));

export const foodPortions = mysqlTable("food_portions", {
  id: int("id").autoincrement().primaryKey(),
  foodId: int("food_id").notNull().references(() => foods.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 120 }).notNull(),
  normalizedLabel: varchar("normalized_label", { length: 120 }).notNull(),
  unit: varchar("unit", { length: 40 }).default("serving").notNull(),
  quantity: double("quantity").default(1).notNull(),
  grams: double("grams").notNull(),
  isDefault: int("is_default").default(0).notNull(),
  sourceId: int("source_id").references(() => foodSources.id, { onDelete: "set null" }),
  sourcePortionCode: varchar("source_portion_code", { length: 120 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  foodIdIdx: index("food_portions_food_id_idx").on(table.foodId),
  sourceIdIdx: index("food_portions_source_id_idx").on(table.sourceId),
  foodLabelUnitUnique: uniqueIndex("food_portions_food_label_unit_unique").on(table.foodId, table.normalizedLabel, table.unit),
}));

export const foodCatalog = mysqlTable("foodCatalog", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  aliases: text("aliases"),
  brandId: int("brandId").references(() => foodBrands.id, { onDelete: "set null" }),
  brandName: varchar("brandName", { length: 255 }),
  foodType: mysqlEnum("foodType", ["generic", "branded"]).default("generic").notNull(),
  barcode: varchar("barcode", { length: 64 }),
  dataSource: varchar("dataSource", { length: 80 }).default("manual").notNull(),
  servingLabel: varchar("servingLabel", { length: 120 }).notNull(),
  servingUnit: varchar("servingUnit", { length: 40 }).default("g").notNull(),
  gramsPerServing: double("gramsPerServing").notNull(),
  calories: double("calories").notNull(),
  protein: double("protein").notNull(),
  carbs: double("carbs").notNull(),
  fat: double("fat").notNull(),
  fiber: double("fiber"),
  isFruit: int("isFruit").default(0).notNull(),
  isVegetable: int("isVegetable").default(0).notNull(),
  isUltraProcessed: int("isUltraProcessed").default(0).notNull(),
  isUserCreated: int("isUserCreated").default(0).notNull(),
  createdByUserId: int("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  brandIdIdx: index("foodCatalog_brandId_idx").on(table.brandId),
  createdByUserIdx: index("foodCatalog_createdByUserId_idx").on(table.createdByUserId),
  foodTypeIdx: index("foodCatalog_foodType_idx").on(table.foodType),
  barcodeUnique: uniqueIndex("foodCatalog_barcode_unique").on(table.barcode),
}));

export const foodFavorites = mysqlTable("foodFavorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  foodCatalogId: int("foodCatalogId").notNull().references(() => foodCatalog.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  userFoodUnique: uniqueIndex("foodFavorites_user_food_idx").on(table.userId, table.foodCatalogId),
  userIdIdx: index("foodFavorites_userId_idx").on(table.userId),
}));

export const userGamificationSettings = mysqlTable("userGamificationSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  enabled: int("enabled").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index("userGamificationSettings_userId_idx").on(table.userId),
}));

export const userBadges = mysqlTable("userBadges", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  badgeCode: varchar("badgeCode", { length: 80 }).notNull(),
  earnedAt: timestamp("earnedAt").defaultNow().notNull(),
  weekStart: varchar("weekStart", { length: 10 }),
  metadataJson: text("metadataJson"),
}, table => ({
  userBadgeUnique: uniqueIndex("userBadges_user_badge_week_idx").on(table.userId, table.badgeCode, table.weekStart),
  userIdIdx: index("userBadges_userId_idx").on(table.userId),
}));

export const portions = mysqlTable("portions", {
  id: int("id").autoincrement().primaryKey(),
  foodCatalogId: int("foodCatalogId").notNull().references(() => foodCatalog.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 120 }).notNull(),
  unit: varchar("unit", { length: 40 }).default("serving").notNull(),
  quantity: double("quantity").default(1).notNull(),
  grams: double("grams").notNull(),
  isDefault: int("isDefault").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  foodCatalogIdIdx: index("portions_foodCatalogId_idx").on(table.foodCatalogId),
  foodUnitIdx: index("portions_food_unit_idx").on(table.foodCatalogId, table.unit),
}));

export const recipes = mysqlTable("recipes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  servings: double("servings").default(1).notNull(),
  totalGrams: double("totalGrams").default(0).notNull(),
  caloriesPerServing: double("caloriesPerServing").default(0).notNull(),
  proteinPerServing: double("proteinPerServing").default(0).notNull(),
  carbsPerServing: double("carbsPerServing").default(0).notNull(),
  fatPerServing: double("fatPerServing").default(0).notNull(),
  visibility: mysqlEnum("visibility", ["private", "shared"]).default("private").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index("recipes_userId_idx").on(table.userId),
  userNameIdx: index("recipes_user_name_idx").on(table.userId, table.name),
}));

export const recipeItems = mysqlTable("recipeItems", {
  id: int("id").autoincrement().primaryKey(),
  recipeId: int("recipeId").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  foodCatalogId: int("foodCatalogId").references(() => foodCatalog.id, { onDelete: "set null" }),
  portionId: int("portionId").references(() => portions.id, { onDelete: "set null" }),
  quantity: double("quantity").default(1).notNull(),
  unit: varchar("unit", { length: 40 }).default("g").notNull(),
  grams: double("grams").default(0).notNull(),
  calories: double("calories").default(0).notNull(),
  protein: double("protein").default(0).notNull(),
  carbs: double("carbs").default(0).notNull(),
  fat: double("fat").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  recipeIdIdx: index("recipeItems_recipeId_idx").on(table.recipeId),
  foodCatalogIdIdx: index("recipeItems_foodCatalogId_idx").on(table.foodCatalogId),
  portionIdIdx: index("recipeItems_portionId_idx").on(table.portionId),
}));

export const meals = mysqlTable("meals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: mysqlEnum("source", ["web", "whatsapp"]).default("web").notNull(),
  status: mysqlEnum("status", ["draft", "confirmed"]).default("draft").notNull(),
  mealLabel: varchar("mealLabel", { length: 80 }).notNull(),
  notes: text("notes"),
  sourceText: text("sourceText"),
  transcript: text("transcript"),
  confidence: double("confidence").default(0.5).notNull(),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userOccurredAtIdx: index("meals_user_occurredAt_idx").on(table.userId, table.occurredAt),
  userStatusIdx: index("meals_user_status_idx").on(table.userId, table.status),
}));

export const mealItems = mysqlTable("mealItems", {
  id: int("id").autoincrement().primaryKey(),
  mealId: int("mealId").notNull().references(() => meals.id, { onDelete: "cascade" }),
  foodCatalogId: int("foodCatalogId").references(() => foodCatalog.id, { onDelete: "set null" }),
  recipeId: int("recipeId").references(() => recipes.id, { onDelete: "set null" }),
  portionId: int("portionId").references(() => portions.id, { onDelete: "set null" }),
  itemType: mysqlEnum("itemType", ["food", "recipe", "free_text"]).default("food").notNull(),
  foodName: varchar("foodName", { length: 255 }).notNull(),
  canonicalName: varchar("canonicalName", { length: 255 }).notNull(),
  portionText: varchar("portionText", { length: 120 }).notNull(),
  quantity: double("quantity").default(1).notNull(),
  unit: varchar("unit", { length: 40 }).default("serving").notNull(),
  servings: double("servings").default(1).notNull(),
  estimatedGrams: double("estimatedGrams").default(0).notNull(),
  calories: double("calories").notNull(),
  protein: double("protein").notNull(),
  carbs: double("carbs").notNull(),
  fat: double("fat").notNull(),
  source: mysqlEnum("source", ["catalog", "hybrid", "heuristic"]).default("catalog").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  mealIdIdx: index("mealItems_mealId_idx").on(table.mealId),
  foodCatalogIdIdx: index("mealItems_foodCatalogId_idx").on(table.foodCatalogId),
  recipeIdIdx: index("mealItems_recipeId_idx").on(table.recipeId),
  portionIdIdx: index("mealItems_portionId_idx").on(table.portionId),
}));

export const mealMedia = mysqlTable("mealMedia", {
  id: int("id").autoincrement().primaryKey(),
  mealId: int("mealId").notNull().references(() => meals.id, { onDelete: "cascade" }),
  mediaType: mysqlEnum("mediaType", ["image", "audio"]).notNull(),
  storageKey: varchar("storageKey", { length: 255 }).notNull(),
  storageUrl: text("storageUrl").notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  originalFileName: varchar("originalFileName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  mealIdIdx: index("mealMedia_mealId_idx").on(table.mealId),
}));

export const mealFavorites = mysqlTable("mealFavorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  mealLabel: varchar("mealLabel", { length: 80 }).notNull(),
  notes: text("notes"),
  itemsJson: text("itemsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  userIdIdx: index("mealFavorites_userId_idx").on(table.userId),
  userNameUnique: uniqueIndex("mealFavorites_user_name_idx").on(table.userId, table.name),
}));

export const mealInferences = mysqlTable("mealInferences", {
  id: int("id").autoincrement().primaryKey(),
  draftId: varchar("draftId", { length: 64 }).notNull().unique(),
  mealId: int("mealId").references(() => meals.id, { onDelete: "set null" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: mysqlEnum("source", ["web", "whatsapp"]).default("web").notNull(),
  requestSummary: text("requestSummary"),
  sourceText: text("sourceText"),
  transcript: text("transcript"),
  mediaJson: text("mediaJson").notNull(),
  reasoning: text("reasoning"),
  confidence: double("confidence").default(0.5).notNull(),
  itemsJson: text("itemsJson").notNull(),
  totalsJson: text("totalsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  userIdIdx: index("mealInferences_userId_idx").on(table.userId),
  mealIdIdx: index("mealInferences_mealId_idx").on(table.mealId),
}));

export const habitMemories = mysqlTable("habitMemories", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  foodName: varchar("foodName", { length: 255 }).notNull(),
  typicalMealLabel: varchar("typicalMealLabel", { length: 80 }),
  preferredPortionGrams: double("preferredPortionGrams").default(0).notNull(),
  notes: text("notes"),
  occurrenceCount: int("occurrenceCount").default(1).notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userFoodIdx: index("habitMemories_user_food_idx").on(table.userId, table.foodName),
  userLastSeenIdx: index("habitMemories_user_lastSeen_idx").on(table.userId, table.lastSeenAt),
}));

export const dailySummaries = mysqlTable("dailySummaries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  summaryDate: varchar("summaryDate", { length: 10 }).notNull(),
  caloriesConsumed: double("caloriesConsumed").default(0).notNull(),
  proteinConsumed: double("proteinConsumed").default(0).notNull(),
  carbsConsumed: double("carbsConsumed").default(0).notNull(),
  fatConsumed: double("fatConsumed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userSummaryDateIdx: index("dailySummaries_user_summaryDate_idx").on(table.userId, table.summaryDate),
}));

export const exercises = mysqlTable("exercises", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  activityType: varchar("activityType", { length: 120 }).notNull(),
  durationMinutes: int("durationMinutes").notNull(),
  caloriesBurned: double("caloriesBurned").notNull(),
  notes: text("notes"),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userOccurredAtIdx: index("exercises_user_occurredAt_idx").on(table.userId, table.occurredAt),
}));

export const weightEntries = mysqlTable("weightEntries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  weightKg: double("weightKg").notNull(),
  measuredAt: timestamp("measuredAt").defaultNow().notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userMeasuredAtIdx: index("weightEntries_user_measuredAt_idx").on(table.userId, table.measuredAt),
}));

export const waterGoals = mysqlTable("waterGoals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  dailyTargetMl: int("dailyTargetMl").default(2500).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const waterLogs = mysqlTable("waterLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  amountMl: int("amountMl").notNull(),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userOccurredAtIdx: index("waterLogs_user_occurredAt_idx").on(table.userId, table.occurredAt),
}));

export const userPreferences = mysqlTable("userPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  preferenceKey: varchar("preferenceKey", { length: 120 }).notNull(),
  preferenceValue: text("preferenceValue").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userKeyUnique: uniqueIndex("userPreferences_user_key_idx").on(table.userId, table.preferenceKey),
}));

export const userRestrictions = mysqlTable("userRestrictions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  restrictionType: mysqlEnum("restrictionType", ["allergy", "intolerance", "diet", "avoidance", "medical", "other"]).default("other").notNull(),
  label: varchar("label", { length: 160 }).notNull(),
  severity: mysqlEnum("severity", ["info", "avoid", "strict"]).default("info").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userTypeIdx: index("userRestrictions_user_type_idx").on(table.userId, table.restrictionType),
  userLabelIdx: index("userRestrictions_user_label_idx").on(table.userId, table.label),
}));

export const whatsappConnections = mysqlTable("whatsappConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  phoneNumber: varchar("phoneNumber", { length: 32 }).notNull(),
  displayName: varchar("displayName", { length: 255 }),
  status: mysqlEnum("status", ["pending", "active", "disabled"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index("whatsappConnections_userId_idx").on(table.userId),
  phoneNumberIdx: index("whatsappConnections_phoneNumber_idx").on(table.phoneNumber),
}));

export const appSecrets = mysqlTable("appSecrets", {
  id: int("id").autoincrement().primaryKey(),
  secretKey: varchar("secretKey", { length: 64 }).notNull().unique(),
  valueEncrypted: text("valueEncrypted").notNull(),
  updatedByUserId: int("updatedByUserId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  updatedByUserIdIdx: index("appSecrets_updatedByUserId_idx").on(table.updatedByUserId),
}));

export const inferenceLogs = mysqlTable("inferenceLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  origin: mysqlEnum("origin", ["web", "whatsapp", "admin"]).default("web").notNull(),
  status: mysqlEnum("status", ["success", "warning", "error"]).default("success").notNull(),
  eventType: varchar("eventType", { length: 120 }).notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  userCreatedAtIdx: index("inferenceLogs_user_createdAt_idx").on(table.userId, table.createdAt),
  eventTypeIdx: index("inferenceLogs_eventType_idx").on(table.eventType),
}));

export const quickEditTokens = mysqlTable("quickEditTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  mealId: int("mealId").notNull().references(() => meals.id, { onDelete: "cascade" }),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  lastAccessedAt: timestamp("lastAccessedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userMealIdx: index("quickEditTokens_user_meal_idx").on(table.userId, table.mealId),
  expiresAtIdx: index("quickEditTokens_expiresAt_idx").on(table.expiresAt),
}));

export type UserWithPasswordHash = typeof users.$inferSelect;
export type User = Omit<UserWithPasswordHash, "passwordHash">;
export type InsertUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;
export type NutritionGoal = typeof nutritionGoals.$inferSelect;
export type InsertNutritionGoal = typeof nutritionGoals.$inferInsert;
export type FoodBrand = typeof foodBrands.$inferSelect;
export type InsertFoodBrand = typeof foodBrands.$inferInsert;
export type FoodSource = typeof foodSources.$inferSelect;
export type InsertFoodSource = typeof foodSources.$inferInsert;
export type GlobalFood = typeof foods.$inferSelect;
export type InsertGlobalFood = typeof foods.$inferInsert;
export type FoodAlias = typeof foodAliases.$inferSelect;
export type InsertFoodAlias = typeof foodAliases.$inferInsert;
export type FoodPortion = typeof foodPortions.$inferSelect;
export type InsertFoodPortion = typeof foodPortions.$inferInsert;
export type Food = typeof foodCatalog.$inferSelect;
export type InsertFood = typeof foodCatalog.$inferInsert;
export type FoodFavorite = typeof foodFavorites.$inferSelect;
export type InsertFoodFavorite = typeof foodFavorites.$inferInsert;
export type UserGamificationSetting = typeof userGamificationSettings.$inferSelect;
export type InsertUserGamificationSetting = typeof userGamificationSettings.$inferInsert;
export type UserBadge = typeof userBadges.$inferSelect;
export type InsertUserBadge = typeof userBadges.$inferInsert;
export type Portion = typeof portions.$inferSelect;
export type InsertPortion = typeof portions.$inferInsert;
export type Recipe = typeof recipes.$inferSelect;
export type InsertRecipe = typeof recipes.$inferInsert;
export type RecipeItem = typeof recipeItems.$inferSelect;
export type InsertRecipeItem = typeof recipeItems.$inferInsert;
export type Meal = typeof meals.$inferSelect;
export type InsertMeal = typeof meals.$inferInsert;
export type MealItem = typeof mealItems.$inferSelect;
export type InsertMealItem = typeof mealItems.$inferInsert;
export type MealMedia = typeof mealMedia.$inferSelect;
export type InsertMealMedia = typeof mealMedia.$inferInsert;
export type MealFavorite = typeof mealFavorites.$inferSelect;
export type InsertMealFavorite = typeof mealFavorites.$inferInsert;
export type HabitMemory = typeof habitMemories.$inferSelect;
export type InsertHabitMemory = typeof habitMemories.$inferInsert;
export type DailyLog = typeof dailySummaries.$inferSelect;
export type InsertDailyLog = typeof dailySummaries.$inferInsert;
export type Exercise = typeof exercises.$inferSelect;
export type InsertExercise = typeof exercises.$inferInsert;
export type ActivityEntry = Exercise;
export type InsertActivityEntry = InsertExercise;
export type WeightEntry = typeof weightEntries.$inferSelect;
export type InsertWeightEntry = typeof weightEntries.$inferInsert;
export type WaterGoal = typeof waterGoals.$inferSelect;
export type InsertWaterGoal = typeof waterGoals.$inferInsert;
export type WaterLog = typeof waterLogs.$inferSelect;
export type InsertWaterLog = typeof waterLogs.$inferInsert;
export type WaterEntry = WaterLog;
export type InsertWaterEntry = InsertWaterLog;
export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;
export type UserRestriction = typeof userRestrictions.$inferSelect;
export type InsertUserRestriction = typeof userRestrictions.$inferInsert;
export type AppSecret = typeof appSecrets.$inferSelect;
export type InsertAppSecret = typeof appSecrets.$inferInsert;
export type InferenceLog = typeof inferenceLogs.$inferSelect;
export type InsertInferenceLog = typeof inferenceLogs.$inferInsert;
export type QuickEditToken = typeof quickEditTokens.$inferSelect;
export type InsertQuickEditToken = typeof quickEditTokens.$inferInsert;
