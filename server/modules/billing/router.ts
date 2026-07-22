import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../../_core/trpc";
import {
  billingAdminGrantOverrideSchema,
  billingAdminListOverridesSchema,
  billingAdminRevokeOverrideSchema,
  billingAdminSearchUsersSchema,
} from "./schemas";
import { billingService } from "./service";

function safeAdminMutationError(error: unknown): TRPCError {
  if (
    error instanceof Error &&
    (error.message.includes("vigência") ||
      error.message.includes("não encontrada"))
  ) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Não foi possível atualizar a liberação administrativa.",
  });
}

export const billingRouter = router({
  me: protectedProcedure.query(({ ctx }) =>
    billingService.getUserEntitlements(ctx.user.id)
  ),
  subscriptionStatus: protectedProcedure.query(({ ctx }) =>
    billingService.getUserSubscriptionStatus(ctx.user.id)
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
        return await billingService.grantAdminOverride({
          ...input,
          grantedByUserId: ctx.user.id,
        });
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
  adminAnalytics: adminProcedure.query(() => billingService.getAdminAnalytics()),
});
