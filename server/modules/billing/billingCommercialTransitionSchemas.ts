import { z } from "zod";

export const billingCommercialTransitionRunSchema = z.object({
  cutoverKey: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/),
  cutoverAt: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(8).max(500),
  dryRun: z.boolean().default(true),
  batchSize: z.number().int().min(1).max(500).default(100),
  retryFailed: z.boolean().default(false),
  confirmation: z.string().trim().max(80).optional(),
});

export const billingCommercialTransitionReconcileSchema = z.object({
  cutoverKey: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/),
});
