import { z } from "zod";

export const MAX_REPORT_RANGE_DAYS = 90;
export const MIN_REPORT_WEEK_OFFSET = -520;
export const MAX_REPORT_WEEK_OFFSET = 520;

export const reportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use datas no formato YYYY-MM-DD.");

export function countInclusiveReportDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export const boundedReportDateRangeSchema = z
  .object({
    startDate: reportDateSchema,
    endDate: reportDateSchema,
  })
  .refine(({ startDate, endDate }) => startDate <= endDate, {
    message: "A data final deve ser igual ou posterior à data inicial.",
    path: ["endDate"],
  })
  .refine(({ startDate, endDate }) => countInclusiveReportDays(startDate, endDate) <= MAX_REPORT_RANGE_DAYS, {
    message: `Escolha um período de até ${MAX_REPORT_RANGE_DAYS} dias.`,
    path: ["endDate"],
  });

export const dashboardTodaySchema = z
  .object({
    date: reportDateSchema.optional(),
  })
  .optional();

export const reportsPeriodSchema = z
  .object({
    weekOffset: z.number().int().min(MIN_REPORT_WEEK_OFFSET).max(MAX_REPORT_WEEK_OFFSET).default(0),
    fallback: z.boolean().optional(),
  })
  .optional();

export const reportsHabitAnalyticsSchema = boundedReportDateRangeSchema;
