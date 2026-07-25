import { type AnyMySqlColumn, boolean, double, foreignKey, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
  timezone: varchar("timezone", { length: 80 }).default("America/Sao_Paulo").notNull(),
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
    includeExerciseCalories: boolean("includeExerciseCalories").default(true).notNull(),
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
  processingLevel: mysqlEnum("processingLevel", [
    "natural_or_minimally_processed",
    "processed_culinary_ingredient",
    "processed",
    "ultra_processed",
  ]),
  classificationSource: varchar("classificationSource", { length: 40 }),
  classificationConfidence: double("classificationConfidence"),
  isUserCreated: int("isUserCreated").default(0).notNull(),
  createdByUserId: int("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  status: mysqlEnum("status", ["active", "deprecated"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  brandIdIdx: index("foodCatalog_brandId_idx").on(table.brandId),
  createdByUserIdx: index("foodCatalog_createdByUserId_idx").on(table.createdByUserId),
  foodTypeIdx: index("foodCatalog_foodType_idx").on(table.foodType),
  statusIdx: index("foodCatalog_status_idx").on(table.status),
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
  foodCatalogId: int("foodCatalogId").notNull().references(() => foodCatalog.id, { onDelete: "restrict" }),
  portionId: int("portionId").references(() => portions.id, { onDelete: "set null" }),
  foodName: varchar("foodName", { length: 255 }).notNull(),
  quantity: double("quantity").notNull(),
  unit: varchar("unit", { length: 40 }).notNull(),
  grams: double("grams").notNull(),
  calories: double("calories").notNull(),
  protein: double("protein").notNull(),
  carbs: double("carbs").notNull(),
  fat: double("fat").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  recipeIdIdx: index("recipeItems_recipeId_idx").on(table.recipeId),
  foodCatalogIdIdx: index("recipeItems_foodCatalogId_idx").on(table.foodCatalogId),
}));

export const mealSchedules = mysqlTable("mealSchedules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  mealLabel: varchar("mealLabel", { length: 120 }).notNull(),
  daysOfWeek: json("daysOfWeek").$type<number[]>().notNull(),
  timeOfDay: varchar("timeOfDay", { length: 5 }).notNull(),
  active: int("active").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index("mealSchedules_userId_idx").on(table.userId),
}));

export const meals = mysqlTable("meals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: mysqlEnum("source", ["web", "whatsapp"]).notNull(),
  mealLabel: varchar("mealLabel", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["draft", "pending_confirmation", "confirmed", "cancelled"]).default("draft").notNull(),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  notes: text("notes"),
  sourceText: text("sourceText"),
  transcript: text("transcript"),
  confidence: double("confidence"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userOccurredIdx: index("meals_user_occurred_idx").on(table.userId, table.occurredAt),
  userStatusIdx: index("meals_user_status_idx").on(table.userId, table.status),
}));

export const mealItems = mysqlTable("mealItems", {
  id: int("id").autoincrement().primaryKey(),
  mealId: int("mealId").notNull().references(() => meals.id, { onDelete: "cascade" }),
  foodId: int("foodId").references(() => foods.id, { onDelete: "set null" }),
  portionId: int("portionId").references(() => foodPortions.id, { onDelete: "set null" }),
  foodName: varchar("foodName", { length: 255 }).notNull(),
  canonicalName: varchar("canonicalName", { length: 255 }),
  portionText: varchar("portionText", { length: 255 }).notNull(),
  quantity: double("quantity"),
  unit: varchar("unit", { length: 40 }),
  servings: double("servings").default(1).notNull(),
  estimatedGrams: double("estimatedGrams"),
  calories: double("calories").notNull(),
  protein: double("protein").notNull(),
  carbs: double("carbs").notNull(),
  fat: double("fat").notNull(),
  source: varchar("source", { length: 40 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  mealIdIdx: index("mealItems_meal_id_idx").on(table.mealId),
  foodIdIdx: index("mealItems_food_id_idx").on(table.foodId),
  portionIdIdx: index("mealItems_portion_id_idx").on(table.portionId),
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
  mealIdIdx: index("mealMedia_meal_id_idx").on(table.mealId),
}));

export const mealInferences = mysqlTable("mealInferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  draftId: varchar("draftId", { length: 64 }).notNull().unique(),
  source: mysqlEnum("source", ["web", "whatsapp"]).notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "cancelled"]).default("pending").notNull(),
  mealLabel: varchar("mealLabel", { length: 120 }).notNull(),
  sourceText: text("sourceText"),
  transcript: text("transcript"),
  confidence: double("confidence"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userStatusIdx: index("mealInferences_user_status_idx").on(table.userId, table.status),
}));

export const appSecrets = mysqlTable("appSecrets", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull(),
  secretType: varchar("secretType", { length: 64 }).notNull(),
  encryptedValue: text("encryptedValue").notNull(),
  iv: varchar("iv", { length: 64 }).notNull(),
  authTag: varchar("authTag", { length: 64 }).notNull(),
  keyId: varchar("keyId", { length: 64 }).notNull(),
  active: int("active").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  providerTypeIdx: index("appSecrets_provider_type_idx").on(table.provider, table.secretType),
  activeIdx: index("appSecrets_active_idx").on(table.active),
}));

export const inferenceLogs = mysqlTable("inferenceLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  origin: mysqlEnum("origin", ["web", "whatsapp"]).notNull(),
  status: mysqlEnum("status", ["success", "warning", "error"]).notNull(),
  eventType: varchar("eventType", { length: 120 }).notNull(),
  detail: text("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  createdAtIdx: index("inferenceLogs_createdAt_idx").on(table.createdAt),
  userCreatedIdx: index("inferenceLogs_user_created_idx").on(table.userId, table.createdAt),
}));

export const dailySummaries = mysqlTable("dailySummaries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: varchar("date", { length: 10 }).notNull(),
  totalCalories: double("totalCalories").default(0).notNull(),
  totalProtein: double("totalProtein").default(0).notNull(),
  totalCarbs: double("totalCarbs").default(0).notNull(),
  totalFat: double("totalFat").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userDateUnique: uniqueIndex("dailySummaries_user_date_idx").on(table.userId, table.date),
}));

export const waterGoals = mysqlTable("waterGoals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  goalMl: int("goalMl").default(2000).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index("waterGoals_userId_idx").on(table.userId),
}));

export const waterLogs = mysqlTable("waterLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  amountMl: int("amountMl").notNull(),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  userOccurredIdx: index("waterLogs_user_occurred_idx").on(table.userId, table.occurredAt),
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
  userMeasuredIdx: index("weightEntries_user_measured_idx").on(table.userId, table.measuredAt),
}));

export const exercises = mysqlTable("exercises", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: mysqlEnum("source", ["manual", "strava"]).default("manual").notNull(),
  sourceActivityId: varchar("sourceActivityId", { length: 128 }),
  name: varchar("name", { length: 255 }).notNull(),
  exerciseType: varchar("exerciseType", { length: 120 }),
  durationMinutes: int("durationMinutes"),
  caloriesBurned: int("caloriesBurned"),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userOccurredIdx: index("exercises_user_occurred_idx").on(table.userId, table.occurredAt),
  userSourceActivityIdx: index("exercises_user_source_activity_idx").on(table.userId, table.source, table.sourceActivityId),
}));

export const stravaConnections = mysqlTable("stravaConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  athleteId: varchar("athleteId", { length: 64 }).notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  scope: varchar("scope", { length: 255 }),
  status: mysqlEnum("status", ["active", "revoked"]).default("active").notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index("stravaConnections_userId_idx").on(table.userId),
  athleteIdIdx: index("stravaConnections_athleteId_idx").on(table.athleteId),
}));

export const userPreferences = mysqlTable("userPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  preferenceKey: varchar("preferenceKey", { length: 120 }).notNull(),
  preferenceValue: text("preferenceValue"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userKeyUnique: uniqueIndex("userPreferences_user_key_idx").on(table.userId, table.preferenceKey),
}));

export const userRestrictions = mysqlTable("userRestrictions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  restrictionType: mysqlEnum("restrictionType", ["allergy", "intolerance", "preference", "medical", "other"]).default("other").notNull(),
  label: varchar("label", { length: 255 }).notNull(),
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
  activePhoneKey: varchar("activePhoneKey", { length: 32 }),
  displayName: varchar("displayName", { length: 255 }),
  status: mysqlEnum("status", ["pending", "active", "disabled"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index("whatsappConnections_userId_idx").on(table.userId),
  phoneNumberIdx: index("whatsappConnections_phoneNumber_idx").on(table.phoneNumber),
  activePhoneUniqueIdx: uniqueIndex("whatsappConnections_activePhoneKey_unique_idx").on(table.activePhoneKey),
}));

export const whatsappConversations = mysqlTable("whatsappConversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  whatsappConnectionId: int("whatsappConnectionId"),
  phoneNumber: varchar("phoneNumber", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["active", "expired", "closed"]).default("active").notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(),
  endedAt: timestamp("endedAt"),
  version: int("version").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userStatusIdx: index("whatsappConversations_user_status_idx").on(table.userId, table.status),
  userLastActivityIdx: index("whatsappConversations_user_lastActivityAt_idx").on(table.userId, table.lastActivityAt),
  whatsappConnectionFk: foreignKey({
    name: "whatsappConversations_whatsappConnectionId_fk",
    columns: [table.whatsappConnectionId],
    foreignColumns: [whatsappConnections.id],
  }).onDelete("set null"),
}));

export type WhatsAppConversation = typeof whatsappConversations.$inferSelect;
export type InsertWhatsAppConversation = typeof whatsappConversations.$inferInsert;

export const whatsappConversationMessages = mysqlTable("whatsappConversationMessages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull(),
  channel: mysqlEnum("channel", ["whatsapp"]).default("whatsapp").notNull(),
  externalMessageId: varchar("externalMessageId", { length: 128 }),
  idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
  contentType: mysqlEnum("contentType", ["text", "image", "audio", "multimodal", "system"]).notNull(),
  rawTextStored: boolean("rawTextStored").default(false).notNull(),
  text: text("text"),
  sanitizedText: text("sanitizedText"),
  transcript: text("transcript"),
  sanitizedTranscript: text("sanitizedTranscript"),
  mediaStorageKey: varchar("mediaStorageKey", { length: 255 }),
  mediaMimeType: varchar("mediaMimeType", { length: 120 }),
  captionText: text("captionText"),
  privacyPolicyVersion: varchar("privacyPolicyVersion", { length: 32 }),
  retentionExpiresAt: timestamp("retentionExpiresAt"),
  respondsToMessageId: int("respondsToMessageId"),
  occurredAt: timestamp("occurredAt").notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  conversationOccurredIdx: index("whatsappConversationMessages_conversation_occurredAt_idx").on(table.conversationId, table.occurredAt, table.id),
  userOccurredIdx: index("whatsappConversationMessages_user_occurredAt_idx").on(table.userId, table.occurredAt, table.id),
  idempotencyKeyUniqueIdx: uniqueIndex("whatsappConversationMessages_idempotencyKey_unique_idx").on(table.idempotencyKey),
  respondsToIdx: index("whatsappConversationMessages_respondsTo_idx").on(table.respondsToMessageId),
  conversationFk: foreignKey({
    name: "whatsappConversationMessages_conversationId_fk",
    columns: [table.conversationId],
    foreignColumns: [whatsappConversations.id],
  }).onDelete("cascade"),
  respondsToFk: foreignKey({
    name: "whatsappConversationMessages_respondsToMessageId_fk",
    columns: [table.respondsToMessageId],
    foreignColumns: [table.id],
  }).onDelete("set null"),
}));

export type WhatsAppConversationMessage = typeof whatsappConversationMessages.$inferSelect;
export type InsertWhatsAppConversationMessage = typeof whatsappConversationMessages.$inferInsert;

export const whatsappMessageDomainLinks = mysqlTable("whatsappMessageDomainLinks", {
  id: int("id").autoincrement().primaryKey(),
  messageId: int("messageId").notNull(),
  mealId: int("mealId").references(() => meals.id, { onDelete: "set null" }),
  mealItemId: int("mealItemId").references(() => mealItems.id, { onDelete: "set null" }),
  waterLogId: int("waterLogId").references(() => waterLogs.id, { onDelete: "set null" }),
  weightEntryId: int("weightEntryId").references(() => weightEntries.id, { onDelete: "set null" }),
  exerciseId: int("exerciseId").references(() => exercises.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  messageIdIdx: index("whatsappMessageDomainLinks_messageId_idx").on(table.messageId),
  mealIdIdx: index("whatsappMessageDomainLinks_mealId_idx").on(table.mealId),
  waterLogIdIdx: index("whatsappMessageDomainLinks_waterLogId_idx").on(table.waterLogId),
  weightEntryIdIdx: index("whatsappMessageDomainLinks_weightEntryId_idx").on(table.weightEntryId),
  exerciseIdIdx: index("whatsappMessageDomainLinks_exerciseId_idx").on(table.exerciseId),
  messageFk: foreignKey({
    name: "whatsappMessageDomainLinks_messageId_fk",
    columns: [table.messageId],
    foreignColumns: [whatsappConversationMessages.id],
  }).onDelete("cascade"),
}));

export type WhatsAppMessageDomainLink = typeof whatsappMessageDomainLinks.$inferSelect;
export type InsertWhatsAppMessageDomainLink = typeof whatsappMessageDomainLinks.$inferInsert;

export const whatsappConversationSummaries = mysqlTable("whatsappConversationSummaries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: int("conversationId").notNull(),
  summaryText: text("summaryText").notNull(),
  fromMessageId: int("fromMessageId"),
  toMessageId: int("toMessageId"),
  promptVersion: varchar("promptVersion", { length: 32 }).notNull(),
  algorithmVersion: varchar("algorithmVersion", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  conversationIdx: index("whatsappConversationSummaries_conversation_createdAt_idx").on(table.conversationId, table.createdAt),
  // Restrição de banco (issue #767): impede que duas regenerações concorrentes do
  // mesmo intervalo (conversationId+toMessageId) insiram resumos duplicados —
  // sem depender de lock em memória.
  conversationToMessageUniqueIdx: uniqueIndex("wa_conv_summary_conv_to_msg_unique_idx").on(table.conversationId, table.toMessageId),
  conversationFk: foreignKey({
    name: "whatsappConversationSummaries_conversationId_fk",
    columns: [table.conversationId],
    foreignColumns: [whatsappConversations.id],
  }).onDelete("cascade"),
  fromMessageFk: foreignKey({
    name: "whatsappConversationSummaries_fromMessageId_fk",
    columns: [table.fromMessageId],
    foreignColumns: [whatsappConversationMessages.id],
  }).onDelete("set null"),
  toMessageFk: foreignKey({
    name: "whatsappConversationSummaries_toMessageId_fk",
    columns: [table.toMessageId],
    foreignColumns: [whatsappConversationMessages.id],
  }).onDelete("set null"),
}));

export type WhatsAppConversationSummary = typeof whatsappConversationSummaries.$inferSelect;
export type InsertWhatsAppConversationSummary = typeof whatsappConversationSummaries.$inferInsert;

export const whatsappPendingOperations = mysqlTable("whatsappPendingOperations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  operationType: varchar("operationType", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "cancelled", "expired", "superseded", "blocked"]).default("pending").notNull(),
  payloadVersion: int("payloadVersion").default(1).notNull(),
  payloadJson: json("payloadJson").$type<Record<string, unknown>>().notNull(),
  promptText: text("promptText").notNull(),
  contextMessageId: int("contextMessageId"),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userStatusCreatedIdx: index("whatsappPendingOperations_user_status_created_idx").on(table.userId, table.status, table.createdAt),
  statusExpiresIdx: index("whatsappPendingOperations_status_expires_idx").on(table.status, table.expiresAt),
  contextMessageIdx: index("whatsappPendingOperations_contextMessage_idx").on(table.contextMessageId),
  contextMessageFk: foreignKey({
    name: "whatsappPendingOperations_contextMessageId_fk",
    columns: [table.contextMessageId],
    foreignColumns: [whatsappConversationMessages.id],
  }).onDelete("set null"),
}));

export const whatsappConversationPendingContext = mysqlTable("whatsappConversationPendingContext", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  operationId: int("operationId").references(() => whatsappPendingOperations.id, { onDelete: "set null" }),
  action: varchar("action", { length: 80 }).notNull(),
  eventType: varchar("eventType", { length: 160 }).notNull(),
  reply: text("reply").notNull(),
  detail: text("detail").notNull(),
  dataJson: json("dataJson").$type<Record<string, unknown>>().notNull(),
  sourceText: text("sourceText"),
  receivedAt: timestamp("receivedAt"),
  status: mysqlEnum("status", ["pending", "completed", "cancelled", "expired", "superseded"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userStatusUpdatedIdx: index("whatsappConversationPendingContext_user_status_updated_idx").on(table.userId, table.status, table.updatedAt),
  statusExpiresIdx: index("whatsappConversationPendingContext_status_expires_idx").on(table.status, table.expiresAt),
  operationIdx: index("whatsappConversationPendingContext_operation_idx").on(table.operationId),
}));

export type User = typeof users.$inferSelect;
export type UserWithPasswordHash = typeof users.$inferSelect;
