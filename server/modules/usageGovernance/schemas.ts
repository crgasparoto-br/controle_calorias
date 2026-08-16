import { z } from "zod";

export const internalUsageAnalyticsSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    userId: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    const to = value.to ? new Date(value.to) : new Date();
    const from = value.from ? new Date(value.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    if (from.getTime() >= to.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A data inicial deve ser anterior à data final." });
      return;
    }
    if (to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A janela máxima de análise é de 31 dias." });
    }
  });

export function resolveInternalUsageAnalyticsWindow(input: {
  from?: string;
  to?: string;
  userId?: number;
}) {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from, to, ...(input.userId ? { userId: input.userId } : {}) };
}
