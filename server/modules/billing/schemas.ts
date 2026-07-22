import { z } from "zod";
import { BILLING_ACCESS_REASONS } from "./types";

export const billingAdminSearchUsersSchema = z.object({
  query: z.string().trim().max(160).default(""),
  limit: z.number().int().min(1).max(50).default(25),
  accessReason: z.enum(BILLING_ACCESS_REASONS).optional(),
});

export const billingAdminGrantOverrideSchema = z.object({
  userId: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2_000),
  startsAt: z.date().optional(),
  endsAt: z.date().nullable().optional(),
});

export const billingAdminRevokeOverrideSchema = z.object({
  overrideId: z.string().uuid(),
  reason: z.string().trim().min(3).max(2_000),
});

export type BillingAdminSearchUsersInput = z.infer<
  typeof billingAdminSearchUsersSchema
>;
export type BillingAdminGrantOverrideInput = z.infer<
  typeof billingAdminGrantOverrideSchema
>;
export type BillingAdminRevokeOverrideInput = z.infer<
  typeof billingAdminRevokeOverrideSchema
>;
