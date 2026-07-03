import { z } from "zod";

export const billingProviderSchema = z.enum(["sandbox", "mercadopago", "asaas"]);

export const billingPlanCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, hífen ou sublinhado.");

export const createBillingCheckoutSchema = z.object({
  planCode: billingPlanCodeSchema,
});

export const cancelBillingSubscriptionSchema = z
  .object({
    cancelAtPeriodEnd: z.boolean().default(true),
  })
  .optional();

export const billingWebhookSchema = z.object({
  provider: billingProviderSchema.default("sandbox"),
  providerEventId: z.string().trim().min(1).max(180),
  eventType: z.string().trim().min(1).max(140),
  providerCustomerId: z.string().trim().min(1).max(180).optional(),
  providerSubscriptionId: z.string().trim().min(1).max(180).optional(),
  status: z.string().trim().min(1).max(80),
  planCode: billingPlanCodeSchema.optional(),
  userId: z.number().int().positive().optional(),
  occurredAt: z.string().datetime().optional(),
  paymentMethodLabel: z.string().trim().min(1).max(80).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  signature: z.string().trim().min(1).max(256).optional(),
  verificationPayload: z.string().optional(),
});

export type CreateBillingCheckoutInput = z.infer<typeof createBillingCheckoutSchema>;
export type CancelBillingSubscriptionInput = z.infer<typeof cancelBillingSubscriptionSchema>;
export type BillingWebhookInput = z.infer<typeof billingWebhookSchema>;
