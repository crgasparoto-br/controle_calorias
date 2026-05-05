import { z } from "zod";

export const goalTargetSchema = z.object({
  calories: z.number().int().min(800).max(8000),
  proteinGrams: z.number().min(20).max(500),
  carbsGrams: z.number().min(20).max(1000),
  fatGrams: z.number().min(10).max(300),
});

export const goalExceptionSchema = goalTargetSchema.extend({
  id: z.number().int().positive().optional(),
  weekday: z.number().int().min(0).max(6),
  durationType: z.enum(["1_week", "2_weeks", "3_weeks", "always"]),
});

export const goalSchema = z.object({
  defaultGoal: goalTargetSchema,
  exceptions: z
    .array(goalExceptionSchema)
    .refine(exceptions => new Set(exceptions.map(item => item.weekday)).size === exceptions.length, "Informe no máximo uma exceção ativa por dia da semana."),
});

export type GoalInput = z.infer<typeof goalSchema>;
