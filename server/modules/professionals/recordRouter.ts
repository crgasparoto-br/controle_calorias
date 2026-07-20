import { protectedProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
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
} from "./schemas";
import {
  createProfessionalGuidance,
  createProfessionalNote,
  getProfessionalRecord,
  listPatientProfessionalGuidances,
  saveProfessionalAssessment,
} from "./recordService";
import { transitionPatientTracking } from "./service";
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

export const professionalRecordRouter = router({
  messages: professionalMessageRouter,
  ai: professionalAiRouter,
  get: protectedProcedure
    .input(professionalRecordSchema)
    .query(({ ctx, input }) => getProfessionalRecord(ctx.user.id, input)),
  saveAssessment: protectedProcedure
    .input(professionalAssessmentSchema)
    .mutation(({ ctx, input }) =>
      saveProfessionalAssessment(ctx.user.id, input)
    ),
  createNote: protectedProcedure
    .input(professionalNoteSchema)
    .mutation(({ ctx, input }) => createProfessionalNote(ctx.user.id, input)),
  createGuidance: protectedProcedure
    .input(professionalGuidanceSchema)
    .mutation(({ ctx, input }) =>
      createProfessionalGuidance(ctx.user.id, input)
    ),
  transitionTracking: protectedProcedure
    .input(professionalTrackingTransitionSchema)
    .mutation(({ ctx, input }) =>
      transitionPatientTracking(ctx.user.id, input)
    ),
  patientGuidances: protectedProcedure.query(({ ctx }) =>
    listPatientProfessionalGuidances(ctx.user.id)
  ),
  operationalAlerts: professionalOperationalAlertsRouter,
  officialGoal: router({
    professionalState: protectedProcedure
      .input(professionalRecordSchema.pick({ patientId: true }))
      .query(({ ctx, input }) =>
        getProfessionalOfficialGoalState(ctx.user.id, input.patientId)
      ),
    activate: protectedProcedure
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
    retryNotification: protectedProcedure
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
