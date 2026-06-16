import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../../_core/trpc";
import { billingPlanCodeSchema, billingWebhookSchema } from "./schemas";
import {
  cancelUserSubscription,
  createBillingCheckout,
  getUserSubscription,
  listBillingPlans,
  processBillingWebhook,
} from "./billingService";

function toBillingError(error: unknown) {
  if (error instanceof Error && error.message === "BILLING_PLAN_NOT_FOUND") {
    return new TRPCError({ code: "NOT_FOUND", message: "Plano de assinatura não encontrado." });
  }
  if (error instanceof Error && error.message === "BILLING_PROVIDER_NOT_CONFIGURED") {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Checkout de assinatura ainda não configurado. Tente novamente mais tarde.",
    });
  }
  if (error instanceof Error && error.message === "BILLING_SUBSCRIPTION_NOT_FOUND") {
    return new TRPCError({ code: "NOT_FOUND", message: "Nenhuma assinatura encontrada para cancelar." });
  }
  return error;
}

export const billingRouter = router({
  plans: publicProcedure.query(async () => listBillingPlans()),
  subscription: protectedProcedure.query(async ({ ctx }) => getUserSubscription(ctx.user.id)),
  checkout: protectedProcedure.input(billingPlanCodeSchema).mutation(async ({ ctx, input }) => {
    try {
      return await createBillingCheckout({
        user: ctx.user,
        planCode: input.planCode,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });
    } catch (error) {
      throw toBillingError(error);
    }
  }),
  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      return await cancelUserSubscription(ctx.user.id);
    } catch (error) {
      throw toBillingError(error);
    }
  }),
  processWebhook: adminProcedure.input(billingWebhookSchema).mutation(async ({ input }) => {
    return processBillingWebhook(input);
  }),
});
