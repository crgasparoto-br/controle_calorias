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

function requireOneTemporalValue(
  input: { occurredAt?: string; dateTimeLocal?: string },
  ctx: z.RefinementCtx,
) {
  if (Boolean(input.occurredAt) === Boolean(input.dateTimeLocal)) {
    ctx.addIssue({
      code: "custom",
      path: ["dateTimeLocal"],
      message: "Informe exatamente um horário para a edição.",
    });
  }
}

const quickEditMealPayloadSchema = updateMealSchema
  .omit({ mealId: true, occurredAt: true })
  .extend({
    occurredAt: z.string().min(1).optional(),
    dateTimeLocal: localDateTimeSchema.optional(),
  })
  .superRefine(requireOneTemporalValue);

const quickEditExercisePayloadSchema = updateExerciseSchema
  .omit({ exerciseId: true, occurredAt: true })
  .extend({
    occurredAt: z.string().min(1).optional(),
    dateTimeLocal: localDateTimeSchema.optional(),
  })
  .superRefine(requireOneTemporalValue);

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
