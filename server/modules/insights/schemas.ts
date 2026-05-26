import { z } from "zod";

const reportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use datas no formato YYYY-MM-DD.");

export const reportsPeriodSchema = z
  .object({
    weekOffset: z.number().int().min(-1).max(0).default(0),
  })
  .optional();

export const reportsHabitAnalyticsSchema = z
  .object({
    startDate: reportDateSchema,
    endDate: reportDateSchema,
  })
  .refine(({ startDate, endDate }) => startDate <= endDate, {
    message: "A data final deve ser igual ou posterior à data inicial.",
    path: ["endDate"],
  });