import { double, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const nutritionGoals = mysqlTable(
  "nutritionGoals",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
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
    userRuleWindowUnique: uniqueIndex("nutritionGoals_user_rule_window_idx").on(table.userId, table.ruleType, table.weekday, table.effectiveFrom),
  }),
);

export const foodCatalog = mysqlTable("foodCatalog", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  aliases: text("aliases"),
  servingLabel: varchar("servingLabel", { length: 120 }).notNull(),
  gramsPerServing: double("gramsPerServing").notNull(),
  calories: double("calories").notNull(),
  protein: double("protein").notNull(),
  carbs: double("carbs").notNull(),
  fat: double("fat").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const meals = mysqlTable("meals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
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
});

export const mealItems = mysqlTable("mealItems", {
  id: int("id").autoincrement().primaryKey(),
  mealId: int("mealId").notNull(),
  foodCatalogId: int("foodCatalogId"),
  foodName: varchar("foodName", { length: 255 }).notNull(),
  canonicalName: varchar("canonicalName", { length: 255 }).notNull(),
  portionText: varchar("portionText", { length: 120 }).notNull(),
  servings: double("servings").default(1).notNull(),
  estimatedGrams: double("estimatedGrams").default(0).notNull(),
  calories: double("calories").notNull(),
  protein: double("protein").notNull(),
  carbs: double("carbs").notNull(),
  fat: double("fat").notNull(),
  source: mysqlEnum("source", ["catalog", "hybrid", "heuristic"]).default("catalog").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const mealMedia = mysqlTable("mealMedia", {
  id: int("id").autoincrement().primaryKey(),
  mealId: int("mealId").notNull(),
  mediaType: mysqlEnum("mediaType", ["image", "audio"]).notNull(),
  storageKey: varchar("storageKey", { length: 255 }).notNull(),
  storageUrl: text("storageUrl").notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  originalFileName: varchar("originalFileName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const mealInferences = mysqlTable("mealInferences", {
  id: int("id").autoincrement().primaryKey(),
  draftId: varchar("draftId", { length: 64 }).notNull().unique(),
  mealId: int("mealId"),
  userId: int("userId").notNull(),
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
});

export const habitMemories = mysqlTable("habitMemories", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  foodName: varchar("foodName", { length: 255 }).notNull(),
  typicalMealLabel: varchar("typicalMealLabel", { length: 80 }),
  preferredPortionGrams: double("preferredPortionGrams").default(0).notNull(),
  notes: text("notes"),
  occurrenceCount: int("occurrenceCount").default(1).notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const dailySummaries = mysqlTable("dailySummaries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  summaryDate: varchar("summaryDate", { length: 10 }).notNull(),
  caloriesConsumed: double("caloriesConsumed").default(0).notNull(),
  proteinConsumed: double("proteinConsumed").default(0).notNull(),
  carbsConsumed: double("carbsConsumed").default(0).notNull(),
  fatConsumed: double("fatConsumed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const whatsappConnections = mysqlTable("whatsappConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  phoneNumber: varchar("phoneNumber", { length: 32 }).notNull(),
  displayName: varchar("displayName", { length: 255 }),
  status: mysqlEnum("status", ["pending", "active", "disabled"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const inferenceLogs = mysqlTable("inferenceLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  origin: mysqlEnum("origin", ["web", "whatsapp", "admin"]).default("web").notNull(),
  status: mysqlEnum("status", ["success", "warning", "error"]).default("success").notNull(),
  eventType: varchar("eventType", { length: 120 }).notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type NutritionGoal = typeof nutritionGoals.$inferSelect;
export type InsertNutritionGoal = typeof nutritionGoals.$inferInsert;
export type Meal = typeof meals.$inferSelect;
export type InsertMeal = typeof meals.$inferInsert;
export type MealItem = typeof mealItems.$inferSelect;
export type InsertMealItem = typeof mealItems.$inferInsert;
export type MealMedia = typeof mealMedia.$inferSelect;
export type InsertMealMedia = typeof mealMedia.$inferInsert;
export type HabitMemory = typeof habitMemories.$inferSelect;
export type InsertHabitMemory = typeof habitMemories.$inferInsert;
export type InferenceLog = typeof inferenceLogs.$inferSelect;
export type InsertInferenceLog = typeof inferenceLogs.$inferInsert;
