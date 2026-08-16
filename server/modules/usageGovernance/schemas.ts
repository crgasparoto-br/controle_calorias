import { z } from "zod";

const isoDate = z.string().datetime();
const reason = z.string().trim().min(3).max(255);
const id = z.string().uuid();

export const internalUsageAnalyticsSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    userId: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    const to = value.to ? new Date(value.to) : new Date();
    const from = value.from ? new Date(value.from) : new Date(to.getTime() - 31 * 24 * 60 * 60 * 1000);
    if (from.getTime() >= to.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A data inicial deve ser anterior à data final." });
      return;
    }
    if (to.getTime() - from.getTime() > 5 * 366 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A janela máxima de análise é de cinco anos." });
    }
  });

export function resolveInternalUsageAnalyticsWindow(input: { from?: string; to?: string; userId?: number }) {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - 31 * 24 * 60 * 60 * 1000);
  return { from, to, ...(input.userId ? { userId: input.userId } : {}) };
}

export const grantUsageAllowanceSchema = z.object({
  subjectType: z.enum(["user", "professional"]),
  subjectId: z.string().trim().min(1).max(191),
  grantType: z.enum(["additional_units", "temporary_exemption"]),
  additionalUnits: z.number().int().positive().optional(),
  reason,
  startsAt: isoDate,
  endsAt: isoDate,
});

export const revokeUsageAllowanceSchema = z.object({ id, reason });

export const openUsageAbuseCaseSchema = z.object({
  subjectUserId: z.number().int().positive(),
  sponsorUserId: z.number().int().positive().optional(),
  signals: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  evidence: z.record(z.union([z.number(), z.string().trim().max(120), z.boolean(), z.null()])).refine(
    value => !Object.keys(value).some(key => /prompt|content|text|message|transcript|audio|image|media|payload|error|secret|token|url/i.test(key)),
    "Evidências não podem conter conteúdo bruto ou campos sensíveis.",
  ),
});

export const reviewUsageAbuseCaseSchema = z.object({
  id,
  outcome: z.enum(["dismissed", "limitation_approved"]),
  reason,
  systemFailuresExcluded: z.literal(true),
  legitimateGrowthReviewed: z.literal(true),
  impact: z.object({
    affectedOperations: z.array(z.string().trim().min(1).max(120)).max(20),
    legitimateGrowthNotes: z.string().trim().max(255).optional(),
  }),
});

export const applyUsageLimitationSchema = z.object({
  abuseCaseId: id,
  subjectUserId: z.number().int().positive(),
  operations: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  reason,
  startsAt: isoDate,
  endsAt: isoDate,
  emergencySecurity: z.boolean().default(false),
  communicatedAt: isoDate.optional(),
  appealOfferedAt: isoDate.optional(),
  secondApprovedByUserId: z.number().int().positive().optional(),
});

export const revokeUsageLimitationSchema = z.object({ id, reason });

export const authorizeConsumptionChargingSchema = z.object({
  policyVersion: z.string().trim().min(1).max(64),
  reason,
  pricing: z.record(z.unknown()).refine(value => Object.keys(value).length > 0, "Preços versionados são obrigatórios."),
  affectedPlans: z.array(z.string().trim().min(1).max(191)).min(1).max(100),
  effectiveFrom: isoDate,
  communicationAt: isoDate,
  rollback: z.record(z.unknown()).refine(value => Object.keys(value).length > 0, "Plano de rollback é obrigatório."),
});

export const revokeConsumptionChargingSchema = z.object({ id, reason });

export const usageLegalHoldSchema = z.object({
  scopeType: z.enum(["global", "user", "subscription"]),
  scopeId: z.string().trim().min(1).max(191),
  reason,
  startsAt: isoDate.optional(),
  endsAt: isoDate.optional(),
});

export const revokeUsageLegalHoldSchema = z.object({ id, reason });
