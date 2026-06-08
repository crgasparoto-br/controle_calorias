import { z } from "zod";

export const mealLabelSchema = z.string().trim().min(1).max(80);

export const mediaInputSchema = z
  .object({
    base64: z.string().min(1),
    mimeType: z.string().min(1),
    fileName: z.string().optional(),
  })
  .optional();

function parseQuantityFromPortionText(portionText: string) {
  const match = portionText.trim().match(/^(\d+(?:[,.]\d+)?)/u);
  if (!match) {
    return null;
  }

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function deriveUnitFromPortionText(portionText: string) {
  const normalized = portionText
    .trim()
    .replace(/^\d+(?:[,.]\d+)?\s*/u, "")
    .trim();

  return normalized || "porção";
}

const mealItemBaseSchema = z.object({
  foodId: z.number().int().positive().optional(),
  portionId: z.number().int().positive().optional(),
  portionQuantity: z.number().positive().max(100).optional(),
  foodName: z.string().min(1),
  canonicalName: z.string().min(1),
  brand: z.string().trim().min(1).max(80).nullable().optional(),
  portionText: z.string().min(1),
  quantity: z.number().min(0.1).max(5000).optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  servings: z.number().min(0.1).max(20),
  estimatedGrams: z.number().min(0).max(5000),
  calories: z.number().min(0).max(10000),
  protein: z.number().min(0).max(1000),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(1000),
  confidence: z.number().min(0).max(1),
  source: z.enum(["catalog", "hybrid", "heuristic"]),
});

export const mealItemSchema = mealItemBaseSchema.transform(item => ({
  ...item,
  quantity: item.quantity ?? parseQuantityFromPortionText(item.portionText) ?? item.servings,
  unit: item.unit?.trim() || deriveUnitFromPortionText(item.portionText),
}));

export const manualMealSchema = z.object({
  mealLabel: mealLabelSchema,
  occurredAt: z.string().min(1),
  notes: z.string().max(500).optional(),
  items: z.array(mealItemSchema).min(1),
});

export const processMealDraftSchema = z.object({
  source: z.enum(["web", "whatsapp"]).default("web"),
  text: z.string().optional(),
  image: mediaInputSchema,
  audio: mediaInputSchema,
});

export const confirmMealSchema = z.object({
  draftId: z.string().min(1),
  mealLabel: mealLabelSchema,
  occurredAt: z.string().min(1),
  notes: z.string().optional(),
  items: z.array(mealItemSchema).min(1),
});

export const updateMealSchema = manualMealSchema.extend({
  mealId: z.number().int().positive(),
});

export const removeMealSchema = z.object({
  mealId: z.number().int().positive(),
});

export const dayTotalsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const copyMealSchema = z.object({
  mealId: z.number().int().positive(),
  occurredAt: z.string().min(1),
  mealLabel: mealLabelSchema.optional(),
});

export const saveFavoriteMealSchema = z.object({
  mealId: z.number().int().positive(),
  name: z.string().trim().min(1).max(80).optional(),
});

export const reuseFavoriteMealSchema = z.object({
  favoriteMealId: z.number().int().positive(),
  occurredAt: z.string().min(1),
});

export type MediaInput = z.infer<typeof mediaInputSchema>;
export type MealItemInput = z.infer<typeof mealItemSchema>;
export type ManualMealInput = z.infer<typeof manualMealSchema>;
export type ProcessMealDraftInput = z.infer<typeof processMealDraftSchema>;
export type ConfirmMealInput = z.infer<typeof confirmMealSchema>;
export type UpdateMealInput = z.infer<typeof updateMealSchema>;
export type CopyMealInput = z.infer<typeof copyMealSchema>;
export type ReuseFavoriteMealInput = z.infer<typeof reuseFavoriteMealSchema>;
export type SaveFavoriteMealInput = z.infer<typeof saveFavoriteMealSchema>;
