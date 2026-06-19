import { z } from "zod";

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de início no formato AAAA-MM-DD.");
const goalExceptionDurationTypes = ["1_week", "2_weeks", "3_weeks", "always"] as const;
type GoalExceptionDuration = (typeof goalExceptionDurationTypes)[number];

const goalExceptionIdSchema = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/, "Informe um identificador numérico para a exceção.").transform(value => Number(value)),
]).optional();

const goalExceptionDurationSchema = z.string()
  .refine(
    durationType => goalExceptionDurationTypes.includes(durationType as GoalExceptionDuration),
    "Informe uma duração válida para a exceção de meta.",
  )
  .transform(durationType => durationType as GoalExceptionDuration);

export const goalTargetSchema = z.object({
  calories: z.number().int().min(800).max(8000),
  proteinGrams: z.number().min(20).max(500),
  carbsGrams: z.number().min(20).max(1000),
  fatGrams: z.number().min(10).max(300),
});

export const goalExceptionSchema = goalTargetSchema.extend({
  id: goalExceptionIdSchema,
  weekday: z.number().int().min(0).max(6),
  durationType: goalExceptionDurationSchema,
  startDate: dateKeySchema.optional(),
});

export const goalSchema = z.object({
  startDate: dateKeySchema.optional(),
  defaultGoal: goalTargetSchema,
  exceptions: z.array(goalExceptionSchema),
}).superRefine((goal, ctx) => {
  const seenExceptionVersions = new Set<string>();

  goal.exceptions.forEach((exception, index) => {
    const effectiveStartDate = exception.startDate ?? goal.startDate ?? "current";
    const versionKey = `${exception.weekday}:${effectiveStartDate}`;

    if (seenExceptionVersions.has(versionKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe no máximo uma exceção para o mesmo dia da semana e data de início.",
        path: ["exceptions", index, "startDate"],
      });
      return;
    }

    seenExceptionVersions.add(versionKey);
  });
});

export const goalForDateSchema = z.object({
  date: dateKeySchema,
});

export type GoalInput = z.infer<typeof goalSchema>;
