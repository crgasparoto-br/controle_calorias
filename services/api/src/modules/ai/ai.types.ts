import { z } from 'zod';

export const extractedFoodSchema = z.object({
  name: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  estimatedCalories: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
  fiber: z.number().min(0).default(0),
  confidenceScore: z.number().min(0).max(1),
});

export const foodExtractionResultSchema = z.object({
  foods: z.array(extractedFoodSchema),
  mealType: z.enum([
    'BREAKFAST',
    'MORNING_SNACK',
    'LUNCH',
    'AFTERNOON_SNACK',
    'DINNER',
    'EVENING_SNACK',
    'OTHER',
  ]),
  needsConfirmation: z.boolean(),
  confirmationMessage: z.string().optional(),
});

export type ExtractedFood = z.infer<typeof extractedFoodSchema>;
export type FoodExtractionResult = z.infer<typeof foodExtractionResultSchema>;

export interface ProcessingContext {
  userId: string;
  messageLogId: string;
  timestamp: Date;
}
