import { z } from "zod";

export const habitualMealLabelSchema = z.string().trim().min(1).max(80);

export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário no formato HH:mm.");

export const mealScheduleItemSchema = z.object({
  mealLabel: habitualMealLabelSchema,
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  enabled: z.boolean().default(true),
});

export const updateMealSchedulesSchema = z.object({
  schedules: z.array(mealScheduleItemSchema).min(1).max(12),
});

export const suggestMealScheduleSchema = z.object({
  occurredAt: z.string().min(1),
  timeZone: z.string().min(1).max(120).optional(),
});

export type HabitualMealLabel = z.infer<typeof habitualMealLabelSchema>;
export type MealScheduleItemInput = z.infer<typeof mealScheduleItemSchema>;
export type UpdateMealSchedulesInput = z.infer<typeof updateMealSchedulesSchema>;
export type SuggestMealScheduleInput = z.infer<typeof suggestMealScheduleSchema>;
