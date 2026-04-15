import { z } from 'zod';

export const createUserSchema = z.object({
  phone: z.string().regex(/^\+\d{10,15}$/, 'Phone must be in E.164 format'),
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  timezone: z.string().default('America/Sao_Paulo'),
});

export const updateUserGoalSchema = z.object({
  caloriesPerDay: z.number().int().min(500).max(10000).optional(),
  proteinPerDay: z.number().min(0).max(500).optional(),
  carbsPerDay: z.number().min(0).max(1000).optional(),
  fatPerDay: z.number().min(0).max(300).optional(),
  fiberPerDay: z.number().min(0).max(100).optional(),
  waterPerDay: z.number().min(0).max(10000).optional(),
  weightGoalKg: z.number().min(20).max(500).optional(),
  currentWeightKg: z.number().min(20).max(500).optional(),
  heightCm: z.number().min(100).max(250).optional(),
  age: z.number().int().min(10).max(120).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  activityLevel: z
    .enum(['SEDENTARY', 'LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE', 'EXTRA_ACTIVE'])
    .optional(),
  goalType: z.enum(['LOSE_WEIGHT', 'MAINTAIN', 'GAIN_WEIGHT', 'BUILD_MUSCLE']).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserGoalInput = z.infer<typeof updateUserGoalSchema>;
