import { z } from "zod";
import {
  getUsageAbuseSignalValidationError,
  isHeavyUsageOperation,
  USAGE_ABUSE_SIGNAL_VALUES,
} from "./abusePolicy";

const isoDate = z.string().datetime();
const reason = z.string().trim().min(3).max(255);
const id = z.string().uuid();
const heavyUsageOperation = z.string().trim().min(1).max(120).refine(
  isHeavyUsageOperation,
  "A operação deve ser uma operação pesada conhecida, capability:* ou flow:*.",
);

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

export const configureUsagePolicySchema = z.object({
  scopeType: z.enum(["global", "user"]),
  scopeId: z.string().trim().min(1).max(191),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()),
  expectedBudgetMicros: z.number().int().positive(),
  alertThresholdPercentages: z.array(z.number().int().min(1).max(100)).length(3).refine(
    values => values.every((value, index) => index === 0 || value > values[index - 1]),
    "Os thresholds devem ser estritamente crescentes.",
  ),
  observationStartsAt: isoDate,
  observationEndsAt: isoDate,
  reason,
});

export const reconcileUsageCostSchema = z.object({
  reconciliationKey: z.string().trim().min(8).max(191),
  usageIdempotencyKey: z.string().trim().min(8).max(191),
  effectiveCostMicros: z.number().int().nonnegative(),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()),
  effectiveAt: isoDate.optional(),
  reason,
});

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

const sanitizedEvidenceValue = z.union([
  z.number(),
  z.string().trim().max(120),
  z.boolean(),
  z.null(),
]);

const sanitizedEvidenceSchema = z.record(
  z.string(),
  z.union([sanitizedEvidenceValue, z.array(heavyUsageOperation).min(1).max(20)]),
).superRefine((value, ctx) => {
  for (const [key, nested] of Object.entries(value)) {
    if (Array.isArray(nested) && key !== "affectedOperations") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "Apenas affectedOperations pode conter uma lista de operações.",
      });
    }
  }
});

export const openUsageAbuseCaseSchema = z.object({
  subjectUserId: z.number().int().positive(),
  sponsorUserId: z.number().int().positive().optional(),
  signals: z.array(z.enum(USAGE_ABUSE_SIGNAL_VALUES)).min(1).max(20),
  evidence: sanitizedEvidenceSchema.refine(
    value => !Object.keys(value).some(key => /prompt|content|text|message|transcript|audio|image|media|payload|error|secret|token|url/i.test(key)),
    "Evidências não podem conter conteúdo bruto ou campos sensíveis.",
  ),
}).superRefine((value, ctx) => {
  const signalError = getUsageAbuseSignalValidationError(value.signals, value.evidence);
  if (signalError) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["signals"], message: signalError });
});

export const reviewUsageAbuseCaseSchema = z.object({
  id,
  outcome: z.enum(["dismissed", "limitation_approved"]),
  reason,
  systemFailuresExcluded: z.literal(true),
  legitimateGrowthReviewed: z.literal(true),
  impact: z.object({
    affectedOperations: z.array(heavyUsageOperation).max(20),
    legitimateGrowthNotes: z.string().trim().max(255).optional(),
  }),
}).superRefine((value, ctx) => {
  if (value.outcome === "limitation_approved" && value.impact.affectedOperations.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["impact", "affectedOperations"],
      message: "usage_abuse_review_operations_required",
    });
  }
});

export const applyUsageLimitationSchema = z.object({
  abuseCaseId: id,
  subjectUserId: z.number().int().positive(),
  operations: z.array(heavyUsageOperation).min(1).max(20),
  reason,
  startsAt: isoDate,
  endsAt: isoDate,
  emergencySecurity: z.boolean().default(false),
  communicatedAt: isoDate.optional(),
  appealOfferedAt: isoDate.optional(),
});

export const revokeUsageLimitationSchema = z.object({ id, reason });

export const submitUsageLimitationAppealSchema = z.object({
  limitationId: id,
  rationale: z.string().trim().min(3).max(1000),
});

export const reviewUsageLimitationAppealSchema = z.object({
  appealId: id,
  result: z.enum(["approved", "denied"]),
  rationale: z.string().trim().min(3).max(1000),
});

export const authorizeConsumptionChargingSchema = z.object({
  policyVersion: z.string().trim().min(1).max(64),
  reason,
  pricing: z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length > 0, "Preços versionados são obrigatórios."),
  affectedPlans: z.array(z.string().trim().min(1).max(191)).min(1).max(100),
  effectiveFrom: isoDate,
  communicationAt: isoDate,
  rollback: z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length > 0, "Plano de rollback é obrigatório."),
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

export const usageAdminOverviewSchema = z.object({
  limit: z.number().int().min(1).max(200).default(100),
});

export const usageAdminEconomicRowsSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  payerUserId: z.number().int().positive().optional(),
  productCode: z.string().trim().min(1).max(120).optional(),
  versionCode: z.string().trim().min(1).max(191).optional(),
  billingCycle: z.string().trim().min(1).max(32).optional(),
});

export const assignUsageAbuseCaseSchema = z.object({
  caseId: id,
  assignedToUserId: z.number().int().positive(),
  reason,
});

export const reprocessUsageRetentionSchema = z.object({
  sourceAuditId: id,
  reason,
});
