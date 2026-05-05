import { relations } from "drizzle-orm";
import {
  appSecrets,
  dailySummaries,
  exercises,
  foodCatalog,
  habitMemories,
  inferenceLogs,
  mealInferences,
  mealItems,
  mealMedia,
  meals,
  nutritionGoals,
  users,
  waterGoals,
  waterLogs,
  whatsappConnections,
} from "./schema";

export const usersRelations = relations(users, ({ many, one }) => ({
  nutritionGoals: many(nutritionGoals),
  meals: many(meals),
  mealInferences: many(mealInferences),
  habitMemories: many(habitMemories),
  dailySummaries: many(dailySummaries),
  exercises: many(exercises),
  waterLogs: many(waterLogs),
  whatsappConnections: many(whatsappConnections),
  inferenceLogs: many(inferenceLogs),
  waterGoal: one(waterGoals),
  updatedAppSecrets: many(appSecrets),
}));

export const nutritionGoalsRelations = relations(nutritionGoals, ({ one }) => ({
  user: one(users, {
    fields: [nutritionGoals.userId],
    references: [users.id],
  }),
}));

export const foodCatalogRelations = relations(foodCatalog, ({ many }) => ({
  mealItems: many(mealItems),
}));

export const mealsRelations = relations(meals, ({ many, one }) => ({
  user: one(users, {
    fields: [meals.userId],
    references: [users.id],
  }),
  items: many(mealItems),
  media: many(mealMedia),
  inferences: many(mealInferences),
}));

export const mealItemsRelations = relations(mealItems, ({ one }) => ({
  meal: one(meals, {
    fields: [mealItems.mealId],
    references: [meals.id],
  }),
  foodCatalog: one(foodCatalog, {
    fields: [mealItems.foodCatalogId],
    references: [foodCatalog.id],
  }),
}));

export const mealMediaRelations = relations(mealMedia, ({ one }) => ({
  meal: one(meals, {
    fields: [mealMedia.mealId],
    references: [meals.id],
  }),
}));

export const mealInferencesRelations = relations(mealInferences, ({ one }) => ({
  user: one(users, {
    fields: [mealInferences.userId],
    references: [users.id],
  }),
  meal: one(meals, {
    fields: [mealInferences.mealId],
    references: [meals.id],
  }),
}));

export const habitMemoriesRelations = relations(habitMemories, ({ one }) => ({
  user: one(users, {
    fields: [habitMemories.userId],
    references: [users.id],
  }),
}));

export const dailySummariesRelations = relations(dailySummaries, ({ one }) => ({
  user: one(users, {
    fields: [dailySummaries.userId],
    references: [users.id],
  }),
}));

export const exercisesRelations = relations(exercises, ({ one }) => ({
  user: one(users, {
    fields: [exercises.userId],
    references: [users.id],
  }),
}));

export const waterGoalsRelations = relations(waterGoals, ({ one }) => ({
  user: one(users, {
    fields: [waterGoals.userId],
    references: [users.id],
  }),
}));

export const waterLogsRelations = relations(waterLogs, ({ one }) => ({
  user: one(users, {
    fields: [waterLogs.userId],
    references: [users.id],
  }),
}));

export const whatsappConnectionsRelations = relations(whatsappConnections, ({ one }) => ({
  user: one(users, {
    fields: [whatsappConnections.userId],
    references: [users.id],
  }),
}));

export const appSecretsRelations = relations(appSecrets, ({ one }) => ({
  updatedByUser: one(users, {
    fields: [appSecrets.updatedByUserId],
    references: [users.id],
  }),
}));

export const inferenceLogsRelations = relations(inferenceLogs, ({ one }) => ({
  user: one(users, {
    fields: [inferenceLogs.userId],
    references: [users.id],
  }),
}));
