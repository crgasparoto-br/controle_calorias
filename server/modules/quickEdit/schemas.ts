import { z } from "zod";
import { updateExerciseSchema } from "../exercises/schemas";
import { updateMealSchema } from "../meals/schemas";

export const quickEditTokenSchema = z.object({
  token: z.string().trim().min(32).max(512),
});

export const quickEditMealUpdateSchema = quickEditTokenSchema.extend({
  meal: updateMealSchema.omit({ mealId: true }),
});

export const quickEditExerciseUpdateSchema = quickEditTokenSchema.extend({
  exercise: updateExerciseSchema.omit({ exerciseId: true }),
});

export type QuickEditTokenInput = z.infer<typeof quickEditTokenSchema>;
export type QuickEditMealUpdateInput = z.infer<typeof quickEditMealUpdateSchema>;
export type QuickEditExerciseUpdateInput = z.infer<typeof quickEditExerciseUpdateSchema>;
