import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../../_core/trpc";
import { usageGovernanceAdminService } from "./adminService";
import { getInternalUsageAnalytics, registerEconomicFact } from "./service";
import {
  applyUsageLimitationSchema,
  authorizeConsumptionChargingSchema,
  grantUsageAllowanceSchema,
  internalUsageAnalyticsSchema,
  openUsageAbuseCaseSchema,
  resolveInternalUsageAnalyticsWindow,
  reviewUsageAbuseCaseSchema,
  revokeConsumptionChargingSchema,
  revokeUsageAllowanceSchema,
  revokeUsageLegalHoldSchema,
  revokeUsageLimitationSchema,
  usageLegalHoldSchema,
} from "./schemas";

const economicFactSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(191),
  payerUserId: z.number().int().positive(),
  subscriptionId: z.string().trim().max(64).optional(),
  productCode: z.string().trim().max(120).optional(),
  versionCode: z.string().trim().max(191).optional(),
  billingCycle: z.string().trim().max(32).optional(),
  factType: z.enum(["contract_revenue", "discount", "coupon", "credit", "refund", "chargeback", "revenue_tax", "receipt_fee", "financial_cost", "usage_cost_correction"]),
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()),
  valueKind: z.enum(["estimated", "effective"]),
  competenceStart: z.string().datetime(),
  competenceEnd: z.string().datetime(),
  effectiveAt: z.string().datetime().optional(),
  reason: z.string().trim().max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function governanceError(error: unknown): never {
  const code = error instanceof Error ? error.message : "usage_governance_error";
  const safe = code.startsWith("usage_") || code.startsWith("consumption_charge_") || code.startsWith("economic_fact_");
  throw new TRPCError({
    code: safe ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
    message: safe ? code : "Não foi possível atualizar a governança de consumo.",
  });
}

export const usageGovernanceRouter = router({
  analytics: adminProcedure.input(internalUsageAnalyticsSchema).query(({ input }) =>
    getInternalUsageAnalytics(resolveInternalUsageAnalyticsWindow(input))),

  recordEconomicFact: adminProcedure.input(economicFactSchema).mutation(async ({ ctx, input }) => {
    try {
      return await registerEconomicFact({
        ...input,
        subscriptionId: input.subscriptionId ?? null,
        productCode: input.productCode ?? null,
        versionCode: input.versionCode ?? null,
        billingCycle: input.billingCycle ?? null,
        competenceStart: new Date(input.competenceStart),
        competenceEnd: new Date(input.competenceEnd),
        effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : undefined,
        reason: input.reason ?? null,
        actorUserId: ctx.user.id,
      });
    } catch (error) { governanceError(error); }
  }),

  grantAllowance: adminProcedure.input(grantUsageAllowanceSchema).mutation(async ({ ctx, input }) => {
    try {
      return await usageGovernanceAdminService.grantTemporaryAllowance({
        ...input,
        additionalUnits: input.additionalUnits ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        actorUserId: ctx.user.id,
      });
    } catch (error) { governanceError(error); }
  }),
  revokeAllowance: adminProcedure.input(revokeUsageAllowanceSchema).mutation(async ({ ctx, input }) => {
    try { await usageGovernanceAdminService.revokeTemporaryAllowance(input.id, ctx.user.id); return { revoked: true as const }; }
    catch (error) { governanceError(error); }
  }),

  openAbuseCase: adminProcedure.input(openUsageAbuseCaseSchema).mutation(async ({ ctx, input }) => {
    try { return await usageGovernanceAdminService.openUsageAbuseCase({ ...input, sponsorUserId: input.sponsorUserId ?? null, actorUserId: ctx.user.id }); }
    catch (error) { governanceError(error); }
  }),
  reviewAbuseCase: adminProcedure.input(reviewUsageAbuseCaseSchema).mutation(async ({ ctx, input }) => {
    try { return await usageGovernanceAdminService.reviewUsageAbuseCase({ ...input, reviewerUserId: ctx.user.id }); }
    catch (error) { governanceError(error); }
  }),
  applyLimitation: adminProcedure.input(applyUsageLimitationSchema).mutation(async ({ ctx, input }) => {
    try {
      return await usageGovernanceAdminService.applyUsageLimitation({
        ...input,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        communicatedAt: input.communicatedAt ? new Date(input.communicatedAt) : null,
        appealOfferedAt: input.appealOfferedAt ? new Date(input.appealOfferedAt) : null,
        secondApprovedByUserId: input.secondApprovedByUserId ?? null,
        approvedByUserId: ctx.user.id,
      });
    } catch (error) { governanceError(error); }
  }),
  revokeLimitation: adminProcedure.input(revokeUsageLimitationSchema).mutation(async ({ ctx, input }) => {
    try { await usageGovernanceAdminService.revokeUsageLimitation(input.id, ctx.user.id, input.reason); return { revoked: true as const }; }
    catch (error) { governanceError(error); }
  }),

  authorizeConsumptionCharging: adminProcedure.input(authorizeConsumptionChargingSchema).mutation(async ({ ctx, input }) => {
    try {
      return await usageGovernanceAdminService.authorizeFutureConsumptionCharging({
        ...input,
        effectiveFrom: new Date(input.effectiveFrom),
        communicationAt: new Date(input.communicationAt),
        actorUserId: ctx.user.id,
      });
    } catch (error) { governanceError(error); }
  }),
  revokeConsumptionCharging: adminProcedure.input(revokeConsumptionChargingSchema).mutation(async ({ ctx, input }) => {
    try { await usageGovernanceAdminService.revokeFutureConsumptionCharging(input.id, ctx.user.id); return { revoked: true as const }; }
    catch (error) { governanceError(error); }
  }),

  placeLegalHold: adminProcedure.input(usageLegalHoldSchema).mutation(async ({ ctx, input }) => {
    try {
      return await usageGovernanceAdminService.placeUsageLegalHold({
        ...input,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        actorUserId: ctx.user.id,
      });
    } catch (error) { governanceError(error); }
  }),
  revokeLegalHold: adminProcedure.input(revokeUsageLegalHoldSchema).mutation(async ({ ctx, input }) => {
    try { await usageGovernanceAdminService.revokeUsageLegalHold(input.id, ctx.user.id); return { revoked: true as const }; }
    catch (error) { governanceError(error); }
  }),
});
