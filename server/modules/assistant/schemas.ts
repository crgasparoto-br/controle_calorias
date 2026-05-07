import { z } from "zod";

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(3).max(600),
});

export const assistantSuggestionItemSchema = z.object({
  foodName: z.string().min(1).max(120),
  portionText: z.string().min(1).max(80),
  estimatedGrams: z.number().min(0).max(5000),
  calories: z.number().min(0).max(2000),
  protein: z.number().min(0).max(200),
  carbs: z.number().min(0).max(250),
  fat: z.number().min(0).max(150),
});

export const assistantSuggestionSchema = z.object({
  text: z.string().min(1),
  suggestedFoods: z.array(assistantSuggestionItemSchema).default([]),
  estimatedCalories: z.number().min(0).max(5000),
  estimatedMacros: z.object({
    protein: z.number().min(0).max(500),
    carbs: z.number().min(0).max(500),
    fat: z.number().min(0).max(500),
  }),
  alert: z.string().optional(),
  educationalNotice: z.string().min(1),
});

export type AssistantRequestInput = z.infer<typeof assistantRequestSchema>;
export type AssistantSuggestion = z.infer<typeof assistantSuggestionSchema>;

