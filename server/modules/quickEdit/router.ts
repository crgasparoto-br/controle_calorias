import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../../_core/trpc";
import { getQuickEditMeal, QuickEditTokenError, updateQuickEditMeal } from "./service";
import { quickEditMealUpdateSchema, quickEditTokenSchema } from "./schemas";

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
  getMeal: publicProcedure.input(quickEditTokenSchema).query(async ({ input }) => {
    try {
      return await getQuickEditMeal(input.token);
    } catch (error) {
      throw toPublicQuickEditError(error);
    }
  }),
  updateMeal: publicProcedure.input(quickEditMealUpdateSchema).mutation(async ({ input }) => {
    try {
      return await updateQuickEditMeal(input.token, input.meal);
    } catch (error) {
      throw toPublicQuickEditError(error);
    }
  }),
});
