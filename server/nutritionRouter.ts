import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { analyticsService } from "./analyticsService";
import { exportUserPrivacyData, requestUserAccountDeletion } from "./db";
import { generateFoodAssistantSuggestion } from "./modules/assistant/service";
import { assistantRequestSchema } from "./modules/assistant/schemas";
import {
  analyzeFoodPhoto,
  confirmFoodPhotoAnalysis,
  getFoodPhotoAnalysis,
  mapPhotoSuggestionsToMealItems,
  rejectFoodPhotoAnalysis,
} from "./modules/photoAnalysis/service";
import {
  analyzeFoodPhotoSchema,
  confirmFoodPhotoAnalysisSchema,
  rejectFoodPhotoAnalysisSchema,
} from "./modules/photoAnalysis/schemas";
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
import { getUserOnboardingProfile } from "./modules/onboarding/profileRead";
import { completeOnboarding } from "./modules/onboarding/service";
import { onboardingSchema } from "./modules/onboarding/schemas";
import {
  listMealSchedules,
  suggestMealLabelForTime,
  updateMealSchedules,
} from "./modules/mealSchedules/service";
import {
  suggestMealScheduleSchema,
  updateMealSchedulesSchema,
} from "./modules/mealSchedules/schemas";
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
import { healthIntegrationService } from "./modules/healthIntegrations/service";
import {
  connectHealthIntegrationSchema,
  disconnectHealthIntegrationSchema,
  syncHealthIntegrationSchema,
} from "./modules/healthIntegrations/schemas";
import {
  accessIdSchema,
  patientIdSchema,
  professionalCommentSchema,
  professionalGoalSuggestionSchema,
  professionalProfileSchema,
  requestPatientAccessSchema,
} from "./modules/professionals/schemas";
import {
  addProfessionalComment,
  approvePatientAccess,
  getProfessionalPatientDashboard,
  getProfessionalProfile,
  listPatientAccessRequests,
  listProfessionalAccesses,
  listProfessionalHistory,
  requestPatientAccess,
  revokePatientAccess,
  suggestGoalAdjustment,
  upsertProfessionalProfile,
} from "./modules/professionals/service";

function mealLabelCategory(label: string) {
  const normalized = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("cafe")) return "breakfast";
  if (normalized.includes("almoco")) return "lunch";
  if (normalized.includes("jantar")) return "dinner";
  if (normalized.includes("lanche")) return "snack";
  return "other";
}

function daysBetweenDates(from: string | number, to: string | number) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
}

export const nutritionRouter = router({
  privacy: router({
    exportData: protectedProcedure.query(async ({ ctx }) => exportUserPrivacyData(ctx.user.id)),
    requestAccountDeletion: protectedProcedure.mutation(async ({ ctx }) => requestUserAccountDeletion(ctx.user.id)),
  }),

  assistant: router({
    suggest: protectedProcedure
      .input(assistantRequestSchema)
      .mutation(async ({ ctx, input }) => generateFoodAssistantSuggestion(ctx.user.id, input)),
  }),

  foodPhotoAnalysis: router({
    analyze: protectedProcedure.input(analyzeFoodPhotoSchema).mutation(async ({ ctx, input }) => {
      const analysis = await analyzeFoodPhoto(ctx.user.id, input);
      return {
        ...analysis,
        editableItems: mapPhotoSuggestionsToMealItems(analysis.suggestedItems),
      };
    }),
    get: protectedProcedure.input(rejectFoodPhotoAnalysisSchema).query(async ({ ctx, input }) => {
      const analysis = await getFoodPhotoAnalysis(ctx.user.id, input.analysisId);
      return analysis
        ? {
            ...analysis,
            editableItems: mapPhotoSuggestionsToMealItems(analysis.suggestedItems),
          }
        : null;
    }),
    reject: protectedProcedure.input(rejectFoodPhotoAnalysisSchema).mutation(async ({ ctx, input }) => rejectFoodPhotoAnalysis(ctx.user.id, input.analysisId)),
    confirm: protectedProcedure
      .input(confirmFoodPhotoAnalysisSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await confirmFoodPhotoAnalysis(ctx.user.id, input);
        void analyticsService.track("meal_created", {
          source: "ai_draft",
          meal_label_category: mealLabelCategory(input.mealLabel),
          item_count: input.items.length,
          has_notes: Boolean(input.notes?.trim()),
          scheduled_for_future: new Date(input.occurredAt).getTime() > Date.now(),
        });
        return result;
      }),
  }),

  healthIntegrations: router({
    status: protectedProcedure.query(async ({ ctx }) => healthIntegrationService.getStatus(ctx.user.id)),
    connect: protectedProcedure
      .input(connectHealthIntegrationSchema)
      .mutation(async ({ ctx, input }) => healthIntegrationService.connect(ctx.user.id, input)),
    disconnect: protectedProcedure
      .input(disconnectHealthIntegrationSchema)
      .mutation(async ({ ctx, input }) => healthIntegrationService.disconnect(ctx.user.id, input)),
    sync: protectedProcedure
      .input(syncHealthIntegrationSchema)
      .mutation(async ({ ctx, input }) => healthIntegrationService.sync(ctx.user.id, input)),
  }),

  professionals: router({
    profile: protectedProcedure.query(async ({ ctx }) => getProfessionalProfile(ctx.user.id)),
    upsertProfile: protectedProcedure
      .input(professionalProfileSchema)
      .mutation(async ({ ctx, input }) => upsertProfessionalProfile(ctx.user.id, input)),
    requestAccess: protectedProcedure
      .input(requestPatientAccessSchema)
      .mutation(async ({ ctx, input }) => requestPatientAccess(ctx.user.id, input)),
    myAccesses: protectedProcedure.query(async ({ ctx }) => listProfessionalAccesses(ctx.user.id)),
    patientRequests: protectedProcedure.query(async ({ ctx }) => listPatientAccessRequests(ctx.user.id)),
    approveAccess: protectedProcedure
      .input(accessIdSchema)
      .mutation(async ({ ctx, input }) => approvePatientAccess(ctx.user.id, input.accessId)),
    revokeAccess: protectedProcedure
      .input(accessIdSchema)
      .mutation(async ({ ctx, input }) => revokePatientAccess(ctx.user.id, input.accessId)),
    patientDashboard: protectedProcedure
      .input(patientIdSchema)
      .query(async ({ ctx, input }) => getProfessionalPatientDashboard(ctx.user.id, input.patientId)),
    addComment: protectedProcedure
      .input(professionalCommentSchema)
      .mutation(async ({ ctx, input }) => addProfessionalComment(ctx.user.id, input)),
    suggestGoalAdjustment: protectedProcedure
      .input(professionalGoalSuggestionSchema)
      .mutation(async ({ ctx, input }) => suggestGoalAdjustment(ctx.user.id, input)),
    history: protectedProcedure.query(async ({ ctx }) => listProfessionalHistory(ctx.user.id)),
  }),

  onboarding: router({
    profile: protectedProcedure.query(async ({ ctx }) => getUserOnboardingProfile(ctx.user.id)),
    complete: protectedProcedure.input(onboardingSchema).mutation(async ({ ctx, input }) => {
      const result = await completeOnboarding(ctx.user.id, input);
      void analyticsService.track("onboarding_completed", {
        objective: input.objective,
        activity_level: input.activityLevel,
        has_restrictions: input.dietaryRestrictions.length > 0,
        has_medical_condition: false,
        has_weight_entry: true,
      });
      void analyticsService.track("weight_logged", { source: "onboarding" });
      return result;
    }),
  }),

  mealSchedules: router({
    list: protectedProcedure.query(async ({ ctx }) => listMealSchedules(ctx.user.id)),
    update: protectedProcedure
      .input(updateMealSchedulesSchema)
      .mutation(async ({ ctx, input }) => updateMealSchedules(ctx.user.id, input)),
    suggest: protectedProcedure
      .input(suggestMealScheduleSchema)
      .query(async ({ ctx, input }) => suggestMealLabelForTime(ctx.user.id, input)),
  }),

  dashboard: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const result = await getDashboardOverview(ctx.user.id);
      void analyticsService.track("daily_dashboard_viewed", { surface: "api" });
      return result;
    }),
  }),

  goals: router({
    get: protectedProcedure.query(async ({ ctx }) => getNutritionGoal(ctx.user.id)),
    update: protectedProcedure.input(goalSchema).mutation(async ({ ctx, input }) => {
      try {
        const result = await updateNutritionGoal(ctx.user.id, input);
        void analyticsService.track("goal_updated", {
          exception_count: input.exceptions.length,
          has_safety_warnings: result.safetyWarnings.length > 0,
        });
        return result;
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
    search: protectedProcedure.input(foodSearchSchema).query(async ({ ctx, input }) => {
      const result = await searchFoodCatalog(ctx.user.id, input);
      void analyticsService.track("food_searched", {
        query_length: input.query?.trim().length ?? 0,
        limit: input.limit ?? 20,
      });
      return result;
    }),
    recent: protectedProcedure.query(async ({ ctx }) => listRecentlyUsedFoods(ctx.user.id)),
    favorite: protectedProcedure.input(favoriteFoodSchema).mutation(async ({ ctx, input }) => setFoodFavorite(ctx.user.id, input)),
    create: protectedProcedure.input(foodFormSchema).mutation(async ({ ctx, input }) => {
      const result = await createFood(ctx.user.id, input);
      void analyticsService.track("food_created", {
        food_type: input.foodType,
        has_barcode: false,
        has_brand: Boolean(input.brandName),
      });
      return result;
    }),
    update: protectedProcedure.input(updateFoodSchema).mutation(async ({ ctx, input }) => updateFood(ctx.user.id, input)),
  }),

  meals: router({
    list: protectedProcedure.query(async ({ ctx }) => listMeals(ctx.user.id)),
    dayTotals: protectedProcedure.input(dayTotalsSchema).query(async ({ ctx, input }) => getDayTotals(ctx.user.id, input.date)),
    createManual: protectedProcedure.input(manualMealSchema).mutation(async ({ ctx, input }) => {
      const result = await createManualMeal(ctx.user.id, input);
      void analyticsService.track("meal_created", {
        source: "web",
        meal_label_category: mealLabelCategory(input.mealLabel),
        item_count: input.items.length,
        has_notes: Boolean(input.notes?.trim()),
        scheduled_for_future: new Date(input.occurredAt).getTime() > Date.now(),
      });
      void analyticsService.track("meal_item_added", {
        source: "web",
        item_count: input.items.length,
        item_type: "food",
      });
      return result;
    }),
    update: protectedProcedure
      .input(updateMealSchema)
      .mutation(async ({ ctx, input }) => updateMeal(ctx.user.id, input)),
    copy: protectedProcedure
      .input(copyMealSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await copyMeal(ctx.user.id, input);
        void analyticsService.track("meal_copied", {
          target_offset_days: daysBetweenDates(Date.now(), input.occurredAt),
        });
        void analyticsService.track("meal_created", {
          source: "copy",
          meal_label_category: mealLabelCategory(result.mealLabel),
          item_count: result.items.length,
          has_notes: Boolean(result.notes),
          scheduled_for_future: new Date(result.occurredAt).getTime() > Date.now(),
        });
        return result;
      }),
    favorites: protectedProcedure.query(async ({ ctx }) => listMealFavorites(ctx.user.id)),
    saveFavorite: protectedProcedure
      .input(saveFavoriteMealSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await saveMealFavorite(ctx.user.id, input);
        void analyticsService.track("favorite_meal_created", { item_count: result.items.length });
        return result;
      }),
    reuseFavorite: protectedProcedure
      .input(reuseFavoriteMealSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await reuseMealFavorite(ctx.user.id, input);
        void analyticsService.track("meal_created", {
          source: "favorite",
          meal_label_category: mealLabelCategory(result.mealLabel),
          item_count: result.items.length,
          has_notes: Boolean(result.notes),
          scheduled_for_future: new Date(result.occurredAt).getTime() > Date.now(),
        });
        return result;
      }),
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
          const result = await confirmMeal(ctx.user.id, input);
          void analyticsService.track("meal_created", {
            source: "ai_draft",
            meal_label_category: mealLabelCategory(input.mealLabel),
            item_count: input.items.length,
            has_notes: Boolean(input.notes?.trim()),
            scheduled_for_future: new Date(input.occurredAt).getTime() > Date.now(),
          });
          void analyticsService.track("meal_item_added", {
            source: "ai_draft",
            item_count: input.items.length,
            item_type: "food",
          });
          return result;
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
    weekly: protectedProcedure.query(async ({ ctx }) => {
      const result = await getWeeklyReport(ctx.user.id);
      void analyticsService.track("weekly_report_viewed", { report_type: "summary" });
      return result;
    }),
    weeklyProgress: protectedProcedure.query(async ({ ctx }) => {
      const result = await getWeeklyProgressReport(ctx.user.id);
      void analyticsService.track("weekly_report_viewed", { report_type: "progress" });
      return result;
    }),
    weeklyInsights: protectedProcedure.query(async ({ ctx }) => {
      const result = await getWeeklyInsightsReport(ctx.user.id);
      void analyticsService.track("weekly_report_viewed", { report_type: "insights" });
      return result;
    }),
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
