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
import { getGamification, updateGamificationSettings } from "./modules/gamification/service";
import { gamificationSettingsSchema } from "./modules/gamification/schemas";
import {
  createFood,
  listRecentlyUsedFoods,
  searchFoodCatalog,
  setFoodFavorite,
  updateFood,
} from "./modules/foods/service";
import {
  favoriteFoodSchema,
  foodFormSchema,
  foodSearchSchema,
  updateFoodSchema,
} from "./modules/foods/schemas";
import { getDashboardOverview, getWeeklyInsightsReport, getWeeklyProgressReport, getWeeklyReport } from "./modules/insights/service";
import { completeOnboarding } from "./modules/onboarding/service";
import { onboardingSchema } from "./modules/onboarding/schemas";
import {
  confirmMeal,
  copyMeal,
  createManualMeal,
  getDayTotals,
  listMealFavorites,
  listMeals,
  MealDraftNotFoundError,
  processMealDraft,
  removeMeal,
  reuseMealFavorite,
  saveMealFavorite,
  updateMeal,
} from "./modules/meals/service";
import {
  confirmMealSchema,
  copyMealSchema,
  dayTotalsSchema,
  manualMealSchema,
  processMealDraftSchema,
  removeMealSchema,
  reuseFavoriteMealSchema,
  saveFavoriteMealSchema,
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

  gamification: router({
    get: protectedProcedure.query(async ({ ctx }) => getGamification(ctx.user.id)),
    updateSettings: protectedProcedure
      .input(gamificationSettingsSchema)
      .mutation(async ({ ctx, input }) => updateGamificationSettings(ctx.user.id, input)),
  }),

  foods: router({
    search: protectedProcedure.input(foodSearchSchema).query(async ({ ctx, input }) => searchFoodCatalog(ctx.user.id, input)),
    recent: protectedProcedure.query(async ({ ctx }) => listRecentlyUsedFoods(ctx.user.id)),
    favorite: protectedProcedure.input(favoriteFoodSchema).mutation(async ({ ctx, input }) => setFoodFavorite(ctx.user.id, input)),
    create: protectedProcedure.input(foodFormSchema).mutation(async ({ ctx, input }) => createFood(ctx.user.id, input)),
    update: protectedProcedure.input(updateFoodSchema).mutation(async ({ ctx, input }) => updateFood(ctx.user.id, input)),
  }),

  meals: router({
    list: protectedProcedure.query(async ({ ctx }) => listMeals(ctx.user.id)),
    dayTotals: protectedProcedure.input(dayTotalsSchema).query(async ({ ctx, input }) => getDayTotals(ctx.user.id, input.date)),
    createManual: protectedProcedure.input(manualMealSchema).mutation(async ({ ctx, input }) => createManualMeal(ctx.user.id, input)),
    update: protectedProcedure
      .input(updateMealSchema)
      .mutation(async ({ ctx, input }) => updateMeal(ctx.user.id, input)),
    copy: protectedProcedure
      .input(copyMealSchema)
      .mutation(async ({ ctx, input }) => copyMeal(ctx.user.id, input)),
    favorites: protectedProcedure.query(async ({ ctx }) => listMealFavorites(ctx.user.id)),
    saveFavorite: protectedProcedure
      .input(saveFavoriteMealSchema)
      .mutation(async ({ ctx, input }) => saveMealFavorite(ctx.user.id, input)),
    reuseFavorite: protectedProcedure
      .input(reuseFavoriteMealSchema)
      .mutation(async ({ ctx, input }) => reuseMealFavorite(ctx.user.id, input)),
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
    weeklyProgress: protectedProcedure.query(async ({ ctx }) => getWeeklyProgressReport(ctx.user.id)),
    weeklyInsights: protectedProcedure.query(async ({ ctx }) => getWeeklyInsightsReport(ctx.user.id)),
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
