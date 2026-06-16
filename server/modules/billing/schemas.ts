import { z } from "zod";

export const billingPlanCodeSchema = z.object({
  planCode: z.string().trim().min(2).max(80),
  successUrl: z.string().trim().url().max(500).optional(),
  cancelUrl: z.string().trim().url().max(500).optional(),
});

export const billingWebhookSchema = z.object({
  providerEventId: z.string().trim().min(1).max(160),
  eventType: z.string().trim().min(1).max(120),
  subscriptionId: z.string().trim().max(160).optional(),
  externalStatus: z.string().trim().min(1).max(80),
  payload: z.unknown().optional(),
});
