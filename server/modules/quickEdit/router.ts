import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../../_core/trpc";
import {
  deleteQuickEditMeal,
  getQuickEditExercise,
  getQuickEditMeal,
  QuickEditTemporalInputError,
  QuickEditTokenError,
  updateQuickEditExercise,
} from "./service";
import { updateQuickEditMealWithWhatsappConfirmation } from "./issue874Service";
import { logInferenceEvent } from "../../db";
import {
  quickEditExerciseUpdateSchema,
  quickEditMealDeleteSchema,
  quickEditMealUpdateSchema,
  quickEditTokenSchema,
} from "./schemas";

function toPublicQuickEditError(error: unknown) {
  if (error instanceof QuickEditTemporalInputError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }

  if (error instanceof QuickEditTokenError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "Link de edição inválido ou expirado.",
    });
  }

  logInferenceEvent({
    origin: "web",
    status: "error",
    eventType: "quick_edit.public_error_sanitized",
    detail:
      "Falha técnica na edição rápida sanitizada antes de responder ao usuário.",
  });
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message:
      "Não foi possível salvar a edição agora. Tente novamente em instantes.",
  });
}

export const quickEditRouter = router({
  getMeal: publicProcedure
    .input(quickEditTokenSchema)
    .query(async ({ input }) => {
      try {
        return await getQuickEditMeal(input.token);
      } catch (error) {
        throw toPublicQuickEditError(error);
      }
    }),
  updateMeal: publicProcedure
    .input(quickEditMealUpdateSchema)
    .mutation(async ({ input }) => {
      try {
        return await updateQuickEditMealWithWhatsappConfirmation(
          input.token,
          input.meal
        );
      } catch (error) {
        throw toPublicQuickEditError(error);
      }
    }),
  deleteMeal: publicProcedure
    .input(quickEditMealDeleteSchema)
    .mutation(async ({ input }) => {
      try {
        return await deleteQuickEditMeal(input.token);
      } catch (error) {
        throw toPublicQuickEditError(error);
      }
    }),
  getExercise: publicProcedure
    .input(quickEditTokenSchema)
    .query(async ({ input }) => {
      try {
        return await getQuickEditExercise(input.token);
      } catch (error) {
        throw toPublicQuickEditError(error);
      }
    }),
  updateExercise: publicProcedure
    .input(quickEditExerciseUpdateSchema)
    .mutation(async ({ input }) => {
      try {
        return await updateQuickEditExercise(input.token, input.exercise);
      } catch (error) {
        throw toPublicQuickEditError(error);
      }
    }),
});
