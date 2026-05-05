import { z } from "zod";

export const exerciseSchema = z.object({
  activityType: z.string().min(2).max(120),
  durationMinutes: z.number().int().min(1).max(1440),
  caloriesBurned: z.number().min(1).max(10000),
  occurredAt: z.string().min(1),
  notes: z.string().max(500).optional(),
});

export const updateExerciseSchema = exerciseSchema.extend({
  exerciseId: z.number().int().positive(),
});

export const removeExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
});

export type ExerciseInput = z.infer<typeof exerciseSchema>;
export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;
