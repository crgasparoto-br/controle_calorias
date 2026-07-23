import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../../_core/trpc";
import {
  professionalAssessmentSchema,
  professionalGuidanceSchema,
  professionalNoteSchema,
  professionalRecordSchema,
  professionalTrackingTransitionSchema,
  professionalOfficialGoalSchema,
  professionalGoalNotificationRetrySchema,
  patientProfessionalGoalReviewSchema,
  patientAdoptProfessionalGoalSchema,
  professionalPortfolioSchema,
} from "./schemas";
import {
  createProfessionalGuidance,
  createProfessionalNote,
  getProfessionalRecord,
  listPatientProfessionalGuidances,
  saveProfessionalAssessment,
} from "./recordService";
import {
  listProfessionalPortfolio,
  transitionPatientTracking,
} from "./service";
import {
  activateProfessionalOfficialGoal,
  deliverProfessionalGoalNotification,
  getPatientProfessionalGoalState,
  getProfessionalGoalByIdForPatient,
  getProfessionalOfficialGoalState,
  ProfessionalGoalConflictError,
  requestProfessionalGoalReview,
} from "./officialGoalsService";
import { updateNutritionGoal } from "../goals/service";
import { getEffectiveUserTimeZone } from "../timeZone/service";
import { professionalOperationalAlertsRouter } from "./operationalAlertsRouter";
import { professionalMessageRouter } from "./messageRouter";
import { professionalAiRouter } from "./aiRouter";
import { professionalSettingsRouter } from "./settingsRouter";
import {
  professionalRecordProcedure,
  professionalReportsProcedure,
} from "./entitledProcedure";
import { professionalPatientContextSchema } from "./patientContextSchemas";
import { getProfessionalPatientContext } from "./patientContextService";

export const professionalRecordRouter = router({
  messages: professionalMessageRouter,
  ai: professionalAiRouter,
  settings: professionalSettingsRouter,
  context: protectedProcedure
    .input(professionalPatientContextSchema)
    .query(({ ctx, input }) =>
      getProfessionalPatientContext(ctx.user.id, input)
    ),
  portfolioReport: professionalReportsProcedure
    .input(professionalPortfolioSchema)
    .query(async ({ ctx, input }) => {
      const result = await listProfessionalPortfolio(ctx.user.id, input);
      return { summary: result.summary };
    }),
  get: professionalRecordProcedure
    .input(professionalRecordSchema)
    .query(({ ctx, input }) => getProfessionalRecord(ctx.user.id, input)),
  saveAssessment: professionalRecordProcedure
    .input(professionalAssessmentSchema)
    .mutation(({ ctx, input }) =>
      saveProfessionalAssessment(ctx.user.id, input)
    ),
  createNote: professionalRecordProcedure
    .input(professionalNoteSchema)
    .mutation(({ ctx, input }) => createProfessionalNote(ctx.user.id, input)),
  createGuidance: professionalRecordProcedure
    .input(professionalGuidanceSchema)
    .mutation(({ ctx, input }) =>
      createProfessionalGuidance(ctx.user.id, input)
    ),
  transitionTracking: professionalRecordProcedure
    .input(professionalTrackingTransitionSchema)
    .mutation(({ ctx, input }) =>
      transitionPatientTracking(ctx.user.id, input)
    ),
  patientGuidances: protectedProcedure.query(({ ctx }) =>
    listPatientProfessionalGuidances(ctx.user.id)
  ),
  operationalAlerts: professionalOperationalAlertsRouter,
  officialGoal: router({
    professionalState: professionalRecordProcedure
      .input(professionalRecordSchema.pick({ patientId: true }))
      .query(({ ctx, input }) =>
        getProfessionalOfficialGoalState(ctx.user.id, input.patientId)
      ),
    activate: professionalRecordProcedure
      .input(professionalOfficialGoalSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          return await activateProfessionalOfficialGoal(ctx.user.id, input);
        } catch (error) {
          if (error instanceof ProfessionalGoalConflictError) {
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          }
          throw error;
        }
      }),
    retryNotification: professionalRecordProcedure
      .input(professionalGoalNotificationRetrySchema)
      .mutation(({ ctx, input }) =>
        deliverProfessionalGoalNotification(input.goalId, ctx.user.id)
      ),
    patientState: protectedProcedure.query(async ({ ctx }) => {
      const timeZone = await getEffectiveUserTimeZone(ctx.user.id);
      return getPatientProfessionalGoalState(ctx.user.id, timeZone);
    }),
    requestReview: protectedProcedure
      .input(patientProfessionalGoalReviewSchema)
      .mutation(({ ctx, input }) =>
        requestProfessionalGoalReview(ctx.user.id, input)
      ),
    adoptAsPersonal: protectedProcedure
      .input(patientAdoptProfessionalGoalSchema)
      .mutation(async ({ ctx, input }) => {
        const goal = await getProfessionalGoalByIdForPatient(
          ctx.user.id,
          input.goalId
        );
        const timeZone = await getEffectiveUserTimeZone(ctx.user.id);
        return updateNutritionGoal(ctx.user.id, goal, timeZone);
      }),
  }),
});
