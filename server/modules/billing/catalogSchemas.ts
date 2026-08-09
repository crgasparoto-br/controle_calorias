import { z } from "zod";
import {
  BILLING_AUDIENCES,
  BILLING_CYCLES,
  BILLING_PAYMENT_METHODS,
} from "./catalogPolicy";

const catalogCode = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const versionCode = z
  .string()
  .trim()
  .min(3)
  .max(191)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const reason = z.string().trim().min(3).max(2_000);


export const billingCouponEligibilitySchema = z.object({
  code: z.string().trim().min(1).max(80),
  versionCode,
});

export const billingAdminCatalogListSchema = z.object({
  limit: z.number().int().min(1).max(200).default(100),
});

export const billingAdminCreateProductSchema = z.object({
  code: catalogCode,
  audience: z.enum(BILLING_AUDIENCES),
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(2_000).nullable().optional(),
  reason,
});

export const billingAdminCreateVersionSchema = z.object({
  productCode: catalogCode,
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(2_000).nullable().optional(),
  billingCycle: z.enum(BILLING_CYCLES),
  currency: z.literal("BRL"),
  unitAmount: z.number().int().positive(),
  capacityLimit: z.number().int().positive().nullable(),
  entitlements: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  coveredBeneficiaryEntitlements: z
    .array(z.string().trim().min(1).max(120))
    .max(100),
  commercialPaymentMethods: z
    .array(z.enum(BILLING_PAYMENT_METHODS))
    .min(1)
    .max(BILLING_PAYMENT_METHODS.length),
  effectiveFrom: z.date(),
  effectiveUntil: z.date().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000),
  reason,
});

export const billingAdminPublishVersionSchema = z.object({
  versionCode,
  effectiveFrom: z.date(),
  reason,
});

export const billingAdminDeactivateVersionSchema = z.object({
  versionCode,
  effectiveUntil: z.date(),
  reason,
});

export const billingAdminCreateCouponRevisionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/),
  discountType: z.enum(["percentage", "fixed_amount"]),
  discountValue: z.number().int().positive(),
  currency: z.literal("BRL").nullable(),
  eligibleProductCodes: z.array(catalogCode).max(100).default([]),
  eligibleVersionCodes: z.array(versionCode).max(100).default([]),
  eligibleCycles: z.array(z.enum(BILLING_CYCLES)).min(1).max(2),
  validFrom: z.date(),
  validUntil: z.date().nullable(),
  maxTotalUses: z.number().int().positive().nullable(),
  maxUsesPerUser: z.number().int().positive().nullable(),
  firstContractOnly: z.boolean(),
  durationCharges: z.number().int().positive(),
  active: z.boolean().default(true),
  reason,
});

export const billingAdminDeactivateCouponSchema = z.object({
  code: z.string().trim().min(1).max(80),
  reason,
});
