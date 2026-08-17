import { z } from "zod";

export const waterGoalSchema = z.object({
  dailyTargetMl: z.number().int().min(250).max(10000),
});

export const waterLogSchema = z.object({
  amountMl: z.number().int().min(50).max(5000),
  occurredAt: z.string().min(1),
});

export const removeWaterLogSchema = z.object({
  waterLogId: z.number().int().positive(),
});

export type WaterGoalInput = z.infer<typeof waterGoalSchema>;
export type WaterLogInput = z.infer<typeof waterLogSchema>;
