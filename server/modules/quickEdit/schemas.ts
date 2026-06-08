import { z } from "zod";
import { updateMealSchema } from "../meals/schemas";

export const quickEditTokenSchema = z.object({
  token: z.string().trim().min(32).max(256),
});

export const quickEditMealUpdateSchema = quickEditTokenSchema.extend({
  meal: updateMealSchema.omit({ mealId: true }),
});

export type QuickEditTokenInput = z.infer<typeof quickEditTokenSchema>;
export type QuickEditMealUpdateInput = z.infer<typeof quickEditMealUpdateSchema>;
