import { relations } from "drizzle-orm";
import {
  appSecrets,
  dailySummaries,
  exercises,
  foodBrands,
  foodCatalog,
  habitMemories,
  inferenceLogs,
  mealInferences,
  mealItems,
  mealMedia,
  meals,
  nutritionGoals,
  portions,
  professionalAccessEvents,
  professionalFollowUpEvents,
  professionalFollowUps,
  professionalPatientAccesses,
  professionalProfiles,
  recipeItems,
  recipes,
  userPreferences,
  userProfiles,
  userRestrictions,
  users,
  waterGoals,
  waterLogs,
  whatsappConnections,
  weightEntries,
} from "./schema";

export const usersRelations = relations(users, ({ many, one }) => ({
  profile: one(userProfiles),
  nutritionGoals: many(nutritionGoals),
  meals: many(meals),
  recipes: many(recipes),
  mealInferences: many(mealInferences),
  habitMemories: many(habitMemories),
  dailySummaries: many(dailySummaries),
  exercises: many(exercises),
  weightEntries: many(weightEntries),
  waterLogs: many(waterLogs),
  preferences: many(userPreferences),
  professionalProfile: one(professionalProfiles),
  professionalAccesses: many(professionalPatientAccesses, { relationName: "professionalAccesses" }),
  patientAccesses: many(professionalPatientAccesses, { relationName: "patientAccesses" }),
  restrictions: many(userRestrictions),
  whatsappConnections: many(whatsappConnections),
  inferenceLogs: many(inferenceLogs),
  waterGoal: one(waterGoals),
  updatedAppSecrets: many(appSecrets),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const nutritionGoalsRelations = relations(nutritionGoals, ({ one }) => ({
  user: one(users, {
    fields: [nutritionGoals.userId],
    references: [users.id],
  }),
}));

export const foodBrandsRelations = relations(foodBrands, ({ many }) => ({
  foods: many(foodCatalog),
}));

export const foodCatalogRelations = relations(foodCatalog, ({ many, one }) => ({
  brand: one(foodBrands, {
    fields: [foodCatalog.brandId],
    references: [foodBrands.id],
  }),
  portions: many(portions),
  mealItems: many(mealItems),
  recipeItems: many(recipeItems),
}));

export const portionsRelations = relations(portions, ({ many, one }) => ({
  food: one(foodCatalog, {
    fields: [portions.foodCatalogId],
    references: [foodCatalog.id],
  }),
  mealItems: many(mealItems),
  recipeItems: many(recipeItems),
}));

export const recipesRelations = relations(recipes, ({ many, one }) => ({
  user: one(users, {
    fields: [recipes.userId],
    references: [users.id],
  }),
  items: many(recipeItems),
  mealItems: many(mealItems),
}));

export const recipeItemsRelations = relations(recipeItems, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeItems.recipeId],
    references: [recipes.id],
  }),
  food: one(foodCatalog, {
    fields: [recipeItems.foodCatalogId],
    references: [foodCatalog.id],
  }),
  portion: one(portions, {
    fields: [recipeItems.portionId],
    references: [portions.id],
  }),
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
  recipe: one(recipes, {
    fields: [mealItems.recipeId],
    references: [recipes.id],
  }),
  portion: one(portions, {
    fields: [mealItems.portionId],
    references: [portions.id],
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

export const weightEntriesRelations = relations(weightEntries, ({ one }) => ({
  user: one(users, {
    fields: [weightEntries.userId],
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

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userPreferences.userId],
    references: [users.id],
  }),
}));

export const professionalProfilesRelations = relations(professionalProfiles, ({ one }) => ({
  user: one(users, {
    fields: [professionalProfiles.userId],
    references: [users.id],
  }),
}));

export const professionalPatientAccessesRelations = relations(professionalPatientAccesses, ({ many, one }) => ({
  professional: one(users, {
    fields: [professionalPatientAccesses.professionalUserId],
    references: [users.id],
    relationName: "professionalAccesses",
  }),
  patient: one(users, {
    fields: [professionalPatientAccesses.patientUserId],
    references: [users.id],
    relationName: "patientAccesses",
  }),
  authorizationEvents: many(professionalAccessEvents),
  followUp: one(professionalFollowUps),
}));

export const professionalAccessEventsRelations = relations(professionalAccessEvents, ({ one }) => ({
  access: one(professionalPatientAccesses, {
    fields: [professionalAccessEvents.accessId],
    references: [professionalPatientAccesses.id],
  }),
  actor: one(users, {
    fields: [professionalAccessEvents.actorUserId],
    references: [users.id],
  }),
}));

export const professionalFollowUpsRelations = relations(professionalFollowUps, ({ many, one }) => ({
  access: one(professionalPatientAccesses, {
    fields: [professionalFollowUps.accessId],
    references: [professionalPatientAccesses.id],
  }),
  statusChangedBy: one(users, {
    fields: [professionalFollowUps.statusChangedByUserId],
    references: [users.id],
  }),
  events: many(professionalFollowUpEvents),
}));

export const professionalFollowUpEventsRelations = relations(professionalFollowUpEvents, ({ one }) => ({
  followUp: one(professionalFollowUps, {
    fields: [professionalFollowUpEvents.followUpId],
    references: [professionalFollowUps.id],
  }),
  actor: one(users, {
    fields: [professionalFollowUpEvents.actorUserId],
    references: [users.id],
  }),
}));

export const userRestrictionsRelations = relations(userRestrictions, ({ one }) => ({
  user: one(users, {
    fields: [userRestrictions.userId],
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
