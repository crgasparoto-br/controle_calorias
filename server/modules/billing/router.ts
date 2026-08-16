import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../../_core/trpc";
import { activateWhatsappOnboardingUser } from "../onboarding/whatsappLeadService";
import {
  getInternalUsageAnalytics,
} from "../usageGovernance/service";
import {
  internalUsageAnalyticsSchema,
  resolveInternalUsageAnalyticsWindow,
} from "../usageGovernance/schemas";
import {
  billingAdminCatalogListSchema,
  billingAdminCreateCouponRevisionSchema,
  billingAdminCreateProductSchema,
  billingAdminCreateVersionSchema,
  billingAdminDeactivateCouponSchema,
  billingAdminDeactivateVersionSchema,
  billingAdminPublishVersionSchema,
  billingCouponEligibilitySchema,
} from "./catalogSchemas";
import { billingCatalogService } from "./catalogRuntime";
import {
  billingAdminGrantOverrideSchema,
  billingAdminListOverridesSchema,
  billingAdminRevokeOverrideSchema,
  billingAdminSearchUsersSchema,
} from "./schemas";
import { billingService } from "./service";

const SAFE_ADMIN_ERROR_PREFIXES = [
  "A vigência final",
  "Liberação administrativa não encontrada",
  "Product and version codes",
  "Catalog version",
  "Catalog validity",
  "Catalog price",
  "The initial billing catalog",
  "Individual products",
  "Professional products",
  "Active catalog versions",
  "Professional catalog versions",
  "Individual catalog versions",
  "Unknown billing entitlement",
  "Unknown billing payment method",
  "Catalog publication",
  "Catalog range review",
  "Billing product not found",
  "Billing catalog version not found",
  "Billing catalog seed drift",
  "Coupon code",
  "Coupon policy",
  "Unknown billing coupon cycle",
  "Coupon discount",
  "Public percentage coupons",
  "Fixed-amount coupons",
  "Percentage coupons",
  "Coupon validity",
  "Coupon usage limits",
  "Coupon duration",
  "Monthly coupons",
  "Yearly coupons",
  "Billing coupon not found",
  "Coupon contract key",
  "Billing coupon references unknown",
] as const;

function safeAdminMutationError(error: unknown): TRPCError {
  if (error instanceof Error) {
    if (
      error.message.startsWith(
        "Administrator authorization changed before catalog mutation."
      )
    ) {
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Sua autorização administrativa mudou. Recarregue a sessão antes de tentar novamente.",
      });
    }
    const safe = SAFE_ADMIN_ERROR_PREFIXES.some(prefix =>
      error.message.startsWith(prefix)
    );
    if (safe) {
      return new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Não foi possível atualizar a configuração comercial.",
  });
}

function safeCatalogQueryError(): TRPCError {
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Não foi possível consultar a configuração comercial.",
  });
}

export const billingRouter = router({
  me: protectedProcedure.query(({ ctx }) =>
    billingService.getUserEntitlements(ctx.user.id)
  ),
  subscriptionStatus: protectedProcedure.query(({ ctx }) =>
    billingService.getUserSubscriptionStatus(ctx.user.id)
  ),
  catalog: protectedProcedure.query(async () => {
    try {
      return await billingCatalogService.listCatalog();
    } catch {
      throw safeCatalogQueryError();
    }
  }),
  couponEligibility: protectedProcedure
    .input(billingCouponEligibilitySchema)
    .query(async ({ ctx, input }) => {
      try {
        return await billingCatalogService.previewCouponEligibility(
          ctx.user.id,
          input
        );
      } catch {
        throw safeCatalogQueryError();
      }
    }),
  refreshOnboardingActivation: protectedProcedure.mutation(({ ctx }) =>
    activateWhatsappOnboardingUser(ctx.user.id)
  ),
  adminSearchUsers: adminProcedure
    .input(billingAdminSearchUsersSchema)
    .query(({ input }) => billingService.searchAdminUsers(input)),
  adminListOverrides: adminProcedure
    .input(billingAdminListOverridesSchema)
    .query(({ input }) =>
      billingService.listAdminOverrides(input.userId, input.limit)
    ),
  adminGrantOverride: adminProcedure
    .input(billingAdminGrantOverrideSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const override = await billingService.grantAdminOverride({
          ...input,
          grantedByUserId: ctx.user.id,
        });
        await activateWhatsappOnboardingUser(
          input.userId,
          "admin_override"
        ).catch(() => undefined);
        return override;
      } catch (error) {
        throw safeAdminMutationError(error);
      }
    }),
  adminRevokeOverride: adminProcedure
    .input(billingAdminRevokeOverrideSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await billingService.revokeAdminOverride({
          ...input,
          revokedByUserId: ctx.user.id,
        });
      } catch (error) {
        throw safeAdminMutationError(error);
      }
    }),
  adminCatalogVersions: adminProcedure
    .input(billingAdminCatalogListSchema)
    .query(async ({ input }) => {
      try {
        return await billingCatalogService.listAdminVersions(input.limit);
      } catch {
        throw safeCatalogQueryError();
      }
    }),
  adminCoupons: adminProcedure
    .input(billingAdminCatalogListSchema)
    .query(async ({ input }) => {
      try {
        return await billingCatalogService.listAdminCoupons(input.limit);
      } catch {
        throw safeCatalogQueryError();
      }
    }),
  adminCreateCatalogProduct: adminProcedure
    .input(billingAdminCreateProductSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await billingCatalogService.createProduct({
          ...input,
          actorUserId: ctx.user.id,
        });
      } catch (error) {
        throw safeAdminMutationError(error);
      }
    }),
  adminCreateCatalogVersion: adminProcedure
    .input(billingAdminCreateVersionSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await billingCatalogService.createVersion({
          ...input,
          actorUserId: ctx.user.id,
        });
      } catch (error) {
        throw safeAdminMutationError(error);
      }
    }),
  adminPublishCatalogVersion: adminProcedure
    .input(billingAdminPublishVersionSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await billingCatalogService.publishVersion({
          ...input,
          actorUserId: ctx.user.id,
        });
      } catch (error) {
        throw safeAdminMutationError(error);
      }
    }),
  adminDeactivateCatalogVersion: adminProcedure
    .input(billingAdminDeactivateVersionSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await billingCatalogService.deactivateVersion({
          ...input,
          actorUserId: ctx.user.id,
        });
      } catch (error) {
        throw safeAdminMutationError(error);
      }
    }),
  adminCreateCouponRevision: adminProcedure
    .input(billingAdminCreateCouponRevisionSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { reason, ...policy } = input;
        return await billingCatalogService.createCouponRevision({
          policy,
          reason,
          actorUserId: ctx.user.id,
        });
      } catch (error) {
        throw safeAdminMutationError(error);
      }
    }),
  adminDeactivateCoupon: adminProcedure
    .input(billingAdminDeactivateCouponSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await billingCatalogService.deactivateCoupon({
          ...input,
          actorUserId: ctx.user.id,
        });
      } catch (error) {
        throw safeAdminMutationError(error);
      }
    }),
  adminAnalytics: adminProcedure.query(() => billingService.getAdminAnalytics()),
  adminUsageAnalytics: adminProcedure
    .input(internalUsageAnalyticsSchema)
    .query(({ input }) =>
      getInternalUsageAnalytics(resolveInternalUsageAnalyticsWindow(input))
    ),
});
