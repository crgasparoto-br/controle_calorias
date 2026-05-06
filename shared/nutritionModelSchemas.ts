import { z } from "zod";

const nonEmptyText = z.string().trim().min(1);
const optionalText = z.string().trim().min(1).optional();
const positiveAmount = z.number().finite().positive();
const nonNegativeAmount = z.number().finite().min(0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestampInput = z.string().datetime();

export const userProfileInputSchema = z.object({
  displayName: optionalText,
  birthDate: isoDate.optional(),
  sex: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]).default("prefer_not_to_say"),
  heightCm: z.number().finite().min(80).max(260).optional(),
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  locale: z.string().trim().min(2).max(16).default("pt-BR"),
});

export const foodBrandInputSchema = z.object({
  name: nonEmptyText.max(255),
  normalizedName: nonEmptyText.max(255),
  countryCode: z.string().trim().length(2).optional(),
  website: z.string().trim().url().max(255).optional(),
});

export const foodInputSchema = z.object({
  slug: nonEmptyText.max(128),
  name: nonEmptyText.max(255),
  aliases: z.string().trim().optional(),
  brandId: z.number().int().positive().optional(),
  foodType: z.enum(["generic", "branded"]).default("generic"),
  barcode: z.string().trim().min(4).max(64).optional(),
  dataSource: nonEmptyText.max(80).default("manual"),
  servingLabel: nonEmptyText.max(120),
  gramsPerServing: positiveAmount,
  calories: nonNegativeAmount,
  protein: nonNegativeAmount,
  carbs: nonNegativeAmount,
  fat: nonNegativeAmount,
  fiber: nonNegativeAmount.optional(),
  isFruit: z.boolean().default(false),
  isVegetable: z.boolean().default(false),
  isUltraProcessed: z.boolean().default(false),
});

export const portionInputSchema = z.object({
  foodCatalogId: z.number().int().positive(),
  label: nonEmptyText.max(120),
  unit: nonEmptyText.max(40).default("serving"),
  quantity: positiveAmount.default(1),
  grams: positiveAmount,
  isDefault: z.boolean().default(false),
});

export const recipeItemInputSchema = z.object({
  foodCatalogId: z.number().int().positive().optional(),
  portionId: z.number().int().positive().optional(),
  quantity: positiveAmount.default(1),
  unit: nonEmptyText.max(40).default("g"),
  grams: nonNegativeAmount.default(0),
  calories: nonNegativeAmount.default(0),
  protein: nonNegativeAmount.default(0),
  carbs: nonNegativeAmount.default(0),
  fat: nonNegativeAmount.default(0),
  notes: z.string().trim().optional(),
});

export const recipeInputSchema = z.object({
  name: nonEmptyText.max(255),
  description: z.string().trim().optional(),
  servings: positiveAmount.default(1),
  totalGrams: nonNegativeAmount.default(0),
  visibility: z.enum(["private", "shared"]).default("private"),
  items: z.array(recipeItemInputSchema).min(1),
});

export const mealItemInputSchema = z.object({
  foodCatalogId: z.number().int().positive().optional(),
  recipeId: z.number().int().positive().optional(),
  portionId: z.number().int().positive().optional(),
  itemType: z.enum(["food", "recipe", "free_text"]).default("food"),
  foodName: nonEmptyText.max(255),
  canonicalName: nonEmptyText.max(255),
  portionText: nonEmptyText.max(120),
  quantity: positiveAmount.default(1),
  unit: nonEmptyText.max(40).default("serving"),
  servings: positiveAmount.default(1),
  estimatedGrams: nonNegativeAmount.default(0),
  calories: nonNegativeAmount,
  protein: nonNegativeAmount,
  carbs: nonNegativeAmount,
  fat: nonNegativeAmount,
}).refine(
  item => item.itemType !== "food" || !!item.foodCatalogId || item.foodName.length > 0,
  "Itens de alimento precisam ter alimento associado ou descrição textual.",
).refine(
  item => item.itemType !== "recipe" || !!item.recipeId,
  "Itens de receita precisam referenciar uma receita.",
);

export const mealInputSchema = z.object({
  mealLabel: nonEmptyText.max(80),
  notes: z.string().trim().optional(),
  occurredAt: timestampInput,
  items: z.array(mealItemInputSchema).min(1),
});

export const nutritionGoalInputSchema = z.object({
  calories: z.number().int().min(1),
  proteinGrams: nonNegativeAmount,
  carbsGrams: nonNegativeAmount,
  fatGrams: nonNegativeAmount,
});

export const weightEntryInputSchema = z.object({
  weightKg: z.number().finite().min(20).max(400),
  measuredAt: timestampInput.optional(),
  notes: z.string().trim().optional(),
});

export const waterEntryInputSchema = z.object({
  amountMl: z.number().int().min(50).max(5000),
  occurredAt: timestampInput.optional(),
});

export const activityEntryInputSchema = z.object({
  activityType: nonEmptyText.max(120),
  durationMinutes: z.number().int().min(1).max(1440),
  caloriesBurned: nonNegativeAmount.max(10000),
  occurredAt: timestampInput.optional(),
  notes: z.string().trim().optional(),
});

export const userPreferenceInputSchema = z.object({
  preferenceKey: nonEmptyText.max(120),
  preferenceValue: nonEmptyText,
});

export const userRestrictionInputSchema = z.object({
  restrictionType: z.enum(["allergy", "intolerance", "diet", "avoidance", "medical", "other"]).default("other"),
  label: nonEmptyText.max(160),
  severity: z.enum(["info", "avoid", "strict"]).default("info"),
  notes: z.string().trim().optional(),
});

export type UserProfileInput = z.infer<typeof userProfileInputSchema>;
export type FoodBrandInput = z.infer<typeof foodBrandInputSchema>;
export type FoodInput = z.infer<typeof foodInputSchema>;
export type PortionInput = z.infer<typeof portionInputSchema>;
export type RecipeInput = z.infer<typeof recipeInputSchema>;
export type RecipeItemInput = z.infer<typeof recipeItemInputSchema>;
export type MealInput = z.infer<typeof mealInputSchema>;
export type MealItemInput = z.infer<typeof mealItemInputSchema>;
export type NutritionGoalInput = z.infer<typeof nutritionGoalInputSchema>;
export type WeightEntryInput = z.infer<typeof weightEntryInputSchema>;
export type WaterEntryInput = z.infer<typeof waterEntryInputSchema>;
export type ActivityEntryInput = z.infer<typeof activityEntryInputSchema>;
export type UserPreferenceInput = z.infer<typeof userPreferenceInputSchema>;
export type UserRestrictionInput = z.infer<typeof userRestrictionInputSchema>;
