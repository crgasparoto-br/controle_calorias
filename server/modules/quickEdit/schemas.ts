import { z } from "zod";
import { updateExerciseSchema } from "../exercises/schemas";
import { updateMealSchema } from "../meals/schemas";

export const quickEditTokenSchema = z.object({
  token: z.string().trim().min(32).max(512),
});

const localDateTimeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, "Informe uma data e um horário local válidos.")
  .max(19);

const quickEditMealPayloadSchema = updateMealSchema
  .omit({ mealId: true, occurredAt: true })
  .extend({
    dateTimeLocal: localDateTimeSchema,
  });

const quickEditExercisePayloadSchema = updateExerciseSchema
  .omit({ exerciseId: true, occurredAt: true })
  .extend({
    dateTimeLocal: localDateTimeSchema,
  });

export const quickEditMealUpdateSchema = quickEditTokenSchema.extend({
  meal: quickEditMealPayloadSchema,
});

export const quickEditMealDeleteSchema = quickEditTokenSchema;

export const quickEditExerciseUpdateSchema = quickEditTokenSchema.extend({
  exercise: quickEditExercisePayloadSchema,
});

export type QuickEditTokenInput = z.infer<typeof quickEditTokenSchema>;
export type QuickEditMealUpdateInput = z.infer<typeof quickEditMealUpdateSchema>;
export type QuickEditMealDeleteInput = z.infer<typeof quickEditMealDeleteSchema>;
export type QuickEditExerciseUpdateInput = z.infer<typeof quickEditExerciseUpdateSchema>;
