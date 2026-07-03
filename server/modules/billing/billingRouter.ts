import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../../_core/trpc";
import {
  BillingError,
  cancelBillingSubscription,
  createBillingCheckout,
  getUserSubscriptionStatus,
  listBillingPlans,
} from "./billingService";
import { cancelBillingSubscriptionSchema, createBillingCheckoutSchema } from "./schemas";

function toBillingTrpcError(error: unknown) {
  if (!(error instanceof BillingError)) return error;

  if (error.code === "PLAN_NOT_FOUND" || error.code === "SUBSCRIPTION_NOT_FOUND") {
    return new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error.code === "PREMIUM_ACCESS_REQUIRED") {
    return new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
  if (error.code === "PLAN_INACTIVE") {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível processar a assinatura agora." });
}

export const billingRouter = router({
  plans: protectedProcedure.query(() => listBillingPlans()),
  subscription: protectedProcedure.query(({ ctx }) => getUserSubscriptionStatus(ctx.user.id)),
  checkout: protectedProcedure.input(createBillingCheckoutSchema).mutation(async ({ ctx, input }) => {
    try {
      return await createBillingCheckout(ctx.user, input);
    } catch (error) {
      throw toBillingTrpcError(error);
    }
  }),
  cancel: protectedProcedure.input(cancelBillingSubscriptionSchema).mutation(async ({ ctx, input }) => {
    try {
      return await cancelBillingSubscription(ctx.user.id, input);
    } catch (error) {
      throw toBillingTrpcError(error);
    }
  }),
});
