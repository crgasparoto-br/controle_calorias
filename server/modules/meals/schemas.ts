import { z } from "zod";

export const mediaInputSchema = z
  .object({
    base64: z.string().min(1),
    mimeType: z.string().min(1),
    fileName: z.string().optional(),
  })
  .optional();

export const mealItemSchema = z.object({
  foodName: z.string().min(1),
  canonicalName: z.string().min(1),
  portionText: z.string().min(1),
  servings: z.number().min(0.1).max(20),
  estimatedGrams: z.number().min(0).max(5000),
  calories: z.number().min(0).max(10000),
  protein: z.number().min(0).max(1000),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(1000),
  confidence: z.number().min(0).max(1),
  source: z.enum(["catalog", "hybrid", "heuristic"]),
});

export const manualMealSchema = z.object({
  mealLabel: z.string().min(1).max(80),
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
  mealLabel: z.string().min(1),
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

export type MediaInput = z.infer<typeof mediaInputSchema>;
export type MealItemInput = z.infer<typeof mealItemSchema>;
export type ManualMealInput = z.infer<typeof manualMealSchema>;
export type ProcessMealDraftInput = z.infer<typeof processMealDraftSchema>;
export type ConfirmMealInput = z.infer<typeof confirmMealSchema>;
export type UpdateMealInput = z.infer<typeof updateMealSchema>;
