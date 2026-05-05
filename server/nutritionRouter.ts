import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { getAdminOverview, getWhatsappTokenStatus, updateWhatsappToken } from "./modules/admin/service";
import { updateWhatsappTokenSchema } from "./modules/admin/schemas";
import {
  createExercise,
  listExercises,
  removeExercise,
  updateExercise,
} from "./modules/exercises/service";
import {
  exerciseSchema,
  removeExerciseSchema,
  updateExerciseSchema,
} from "./modules/exercises/schemas";
import { getNutritionGoal, UnsafeNutritionGoalError, updateNutritionGoal } from "./modules/goals/service";
import { goalSchema } from "./modules/goals/schemas";
import { getDashboardOverview, getWeeklyReport } from "./modules/insights/service";
import { completeOnboarding } from "./modules/onboarding/service";
import { onboardingSchema } from "./modules/onboarding/schemas";
import {
  confirmMeal,
  createManualMeal,
  listMeals,
  MealDraftNotFoundError,
  processMealDraft,
  removeMeal,
  updateMeal,
} from "./modules/meals/service";
import {
  confirmMealSchema,
  manualMealSchema,
  processMealDraftSchema,
  removeMealSchema,
  updateMealSchema,
} from "./modules/meals/schemas";
import {
  createWaterLog,
  getWaterGoal,
  listWaterLogs,
  removeWaterLog,
  updateWaterGoal,
} from "./modules/water/service";
import {
  removeWaterLogSchema,
  waterGoalSchema,
  waterLogSchema,
} from "./modules/water/schemas";
import {
  getWhatsappStatus,
  OfficialWhatsappNumberError,
  simulateWhatsappInbound,
  updateWhatsappConnection,
} from "./modules/whatsapp/service";
import {
  simulateWhatsappInboundSchema,
  whatsappConnectionSchema,
} from "./modules/whatsapp/schemas";

export const nutritionRouter = router({
  onboarding: router({
    complete: protectedProcedure.input(onboardingSchema).mutation(async ({ ctx, input }) => completeOnboarding(ctx.user.id, input)),
  }),

  dashboard: router({
    overview: protectedProcedure.query(async ({ ctx }) => getDashboardOverview(ctx.user.id)),
  }),

  goals: router({
    get: protectedProcedure.query(async ({ ctx }) => getNutritionGoal(ctx.user.id)),
    update: protectedProcedure.input(goalSchema).mutation(async ({ ctx, input }) => {
      try {
        return await updateNutritionGoal(ctx.user.id, input);
      } catch (error) {
        if (!(error instanceof UnsafeNutritionGoalError)) {
          throw error;
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error.message,
        });
      }
    }),
  }),

  meals: router({
    list: protectedProcedure.query(async ({ ctx }) => listMeals(ctx.user.id)),
    createManual: protectedProcedure.input(manualMealSchema).mutation(async ({ ctx, input }) => createManualMeal(ctx.user.id, input)),
    update: protectedProcedure
      .input(updateMealSchema)
      .mutation(async ({ ctx, input }) => updateMeal(ctx.user.id, input)),
    remove: protectedProcedure
      .input(removeMealSchema)
      .mutation(async ({ ctx, input }) => removeMeal(ctx.user.id, input.mealId)),
    processDraft: protectedProcedure
      .input(processMealDraftSchema)
      .mutation(async ({ ctx, input }) => processMealDraft(ctx.user.id, input)),
    confirm: protectedProcedure
      .input(confirmMealSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          return await confirmMeal(ctx.user.id, input);
        } catch (error) {
          if (!(error instanceof MealDraftNotFoundError)) {
            throw error;
          }

          throw new TRPCError({ code: "NOT_FOUND", message: "Rascunho não encontrado para confirmação." });
        }
      }),
  }),

  exercises: router({
    list: protectedProcedure.query(async ({ ctx }) => listExercises(ctx.user.id)),
    create: protectedProcedure.input(exerciseSchema).mutation(async ({ ctx, input }) => createExercise(ctx.user.id, input)),
    update: protectedProcedure
      .input(updateExerciseSchema)
      .mutation(async ({ ctx, input }) => updateExercise(ctx.user.id, input)),
    remove: protectedProcedure
      .input(removeExerciseSchema)
      .mutation(async ({ ctx, input }) => removeExercise(ctx.user.id, input.exerciseId)),
  }),

  water: router({
    goal: protectedProcedure.query(async ({ ctx }) => getWaterGoal(ctx.user.id)),
    updateGoal: protectedProcedure.input(waterGoalSchema).mutation(async ({ ctx, input }) => updateWaterGoal(ctx.user.id, input)),
    list: protectedProcedure.query(async ({ ctx }) => listWaterLogs(ctx.user.id)),
    create: protectedProcedure.input(waterLogSchema).mutation(async ({ ctx, input }) => createWaterLog(ctx.user.id, input)),
    remove: protectedProcedure
      .input(removeWaterLogSchema)
      .mutation(async ({ ctx, input }) => removeWaterLog(ctx.user.id, input.waterLogId)),
  }),

  reports: router({
    weekly: protectedProcedure.query(async ({ ctx }) => getWeeklyReport(ctx.user.id)),
  }),

  admin: router({
    overview: adminProcedure.query(async () => getAdminOverview()),
    whatsappTokenStatus: adminProcedure.query(async () => getWhatsappTokenStatus()),
    updateWhatsappToken: adminProcedure
      .input(updateWhatsappTokenSchema)
      .mutation(async ({ ctx, input }) => updateWhatsappToken(ctx.user.id, input)),
  }),

  whatsapp: router({
    status: protectedProcedure.query(async ({ ctx }) => getWhatsappStatus(ctx.user.id)),
    upsertConnection: protectedProcedure
      .input(whatsappConnectionSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          return await updateWhatsappConnection(ctx.user.id, input);
        } catch (error) {
          if (!(error instanceof OfficialWhatsappNumberError)) {
            throw error;
          }

          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Informe o telefone de origem do usuário final, não o número oficial fixo da solução.",
          });
        }
      }),
    simulateInbound: protectedProcedure
      .input(simulateWhatsappInboundSchema)
      .mutation(async ({ ctx, input }) => simulateWhatsappInbound(ctx.user.id, input)),
  }),
});
