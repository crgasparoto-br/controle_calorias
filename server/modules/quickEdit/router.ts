import { TRPCError } from "@trpc/server";
import { RATE_LIMITS } from "../../_core/rateLimit";
import { rateLimitedPublicProcedure, router } from "../../_core/trpc";
import { getQuickEditMeal, QuickEditTokenError, updateQuickEditMeal } from "./service";
import { quickEditMealUpdateSchema, quickEditTokenSchema } from "./schemas";

const quickEditPublicProcedure = rateLimitedPublicProcedure(RATE_LIMITS.quickEdit);

function toPublicQuickEditError(error: unknown) {
  if (error instanceof QuickEditTokenError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "Link de edição inválido ou expirado.",
    });
  }

  return error;
}

export const quickEditRouter = router({
  getMeal: quickEditPublicProcedure.input(quickEditTokenSchema).query(async ({ input }) => {
    try {
      return await getQuickEditMeal(input.token);
    } catch (error) {
      throw toPublicQuickEditError(error);
    }
  }),
  updateMeal: quickEditPublicProcedure.input(quickEditMealUpdateSchema).mutation(async ({ input }) => {
    try {
      return await updateQuickEditMeal(input.token, input.meal);
    } catch (error) {
      throw toPublicQuickEditError(error);
    }
  }),
});