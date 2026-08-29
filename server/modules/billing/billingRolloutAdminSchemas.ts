import { z } from "zod";

export const billingRolloutPhaseSchema = z.enum([
  "fake",
  "sandbox",
  "internal",
  "pilot_a",
  "pilot_b",
  "general_non_blocking",
  "enforced_10",
  "enforced_25",
  "enforced_50",
  "enforced_100",
]);

const reason = z.string().trim().min(3).max(500);
const owner = z.string().trim().min(2).max(120);

export const billingRolloutSnapshotSchema = z.object({
  phase: billingRolloutPhaseSchema,
  snapshotKey: z.string().trim().min(3).max(120),
  ruleVersion: z.string().trim().min(1).max(64),
  criterion: z.string().trim().min(3).max(500),
  candidateUserIds: z.array(z.number().int().positive()).min(1).max(5000),
  percentage: z.number().int().min(0).max(100),
  reason,
});

export const billingRolloutGateDecisionSchema = z.object({
  phase: billingRolloutPhaseSchema,
  decision: z.enum(["advance", "hold", "reject"]),
  reason,
  reinforcedConfirmation: z.boolean().default(false),
  resumeAfterIncident: z.boolean().default(false),
  owners: z.object({
    product: owner,
    technical: owner,
    billing: owner,
    support: owner,
    authorizer: owner,
    privacyLegal: owner.optional(),
    accountant: owner.optional(),
  }),
  metrics: z.object({
    processedWithin5mBps: z.number().int().min(0).max(10000),
    reconciledWithin30mBps: z.number().int().min(0).max(10000),
    financialDivergenceBps: z.number().int().min(0).max(10000),
    internalNotificationsPersistedBps: z.number().int().min(0).max(10000),
  }),
  evidence: z.array(z.string().trim().min(3).max(500)).min(1).max(50),
});

export const billingRolloutPauseSchema = z.object({
  phase: billingRolloutPhaseSchema,
  paused: z.boolean(),
  scope: z.enum(["activations", "communications", "blocks", "all"]),
  reason,
  reinforcedConfirmation: z.boolean().default(false),
});

export const billingRolloutIncidentSchema = z.object({
  incidentId: z.string().trim().min(3).max(120),
  phase: billingRolloutPhaseSchema,
  severity: z.enum(["low", "medium", "high", "critical"]),
  type: z.enum([
    "duplicate_charge",
    "improper_activation",
    "improper_block",
    "data_loss",
    "sensitive_exposure",
    "reconciliation_failure",
    "essential_notification_failure",
    "service_degradation",
    "security_incident",
    "other",
  ]),
  status: z.enum(["open", "resolved"]),
  affectedUsers: z.number().int().nonnegative(),
  cause: reason,
  impact: reason,
  correction: z.string().trim().max(500).optional(),
});

export const billingRolloutRollbackSchema = z.object({
  phase: billingRolloutPhaseSchema,
  snapshotKey: z.string().trim().min(3).max(120).optional(),
  reason,
  pauseCommunications: z.boolean().default(true),
  pauseBlocks: z.boolean().default(true),
  reinforcedConfirmation: z.literal(true),
});
