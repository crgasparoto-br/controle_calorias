import { z } from "zod";
import { mediaInputSchema, mealItemSchema } from "../meals/schemas";

export const foodPhotoAnalysisStatusSchema = z.enum(["pending", "analyzed", "confirmed", "rejected"]);

export const foodPhotoSuggestedItemSchema = z.object({
  foodName: z.string().trim().min(1).max(120),
  estimatedQuantity: z.number().min(0).max(5000),
  unit: z.string().trim().min(1).max(40),
  estimatedCalories: z.number().min(0).max(10000),
  estimatedMacros: z.object({
    protein: z.number().min(0).max(1000),
    carbs: z.number().min(0).max(1000),
    fat: z.number().min(0).max(1000),
  }),
  confidenceScore: z.number().min(0).max(1),
});

export const analyzeFoodPhotoSchema = z.object({
  image: mediaInputSchema.refine(Boolean, "Envie uma foto para análise."),
});

export const confirmFoodPhotoAnalysisSchema = z.object({
  analysisId: z.string().min(1),
  mealLabel: z.enum(["café da manhã", "almoço", "jantar", "lanche", "outro"]),
  occurredAt: z.string().min(1),
  notes: z.string().max(500).optional(),
  items: z.array(mealItemSchema).min(1),
});

export const rejectFoodPhotoAnalysisSchema = z.object({
  analysisId: z.string().min(1),
});

export type FoodPhotoAnalysisStatus = z.infer<typeof foodPhotoAnalysisStatusSchema>;
export type FoodPhotoSuggestedItem = z.infer<typeof foodPhotoSuggestedItemSchema>;
export type AnalyzeFoodPhotoInput = z.infer<typeof analyzeFoodPhotoSchema>;
export type ConfirmFoodPhotoAnalysisInput = z.infer<typeof confirmFoodPhotoAnalysisSchema>;
export type RejectFoodPhotoAnalysisInput = z.infer<typeof rejectFoodPhotoAnalysisSchema>;

