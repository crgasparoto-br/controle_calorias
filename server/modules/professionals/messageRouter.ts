import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../../_core/trpc";
import { professionalMessagesProcedure } from "./entitledProcedure";
import {
  patientProfessionalMessageListSchema,
  professionalMessageCreateSchema,
  professionalMessageListSchema,
  professionalMessageRetrySchema,
} from "./schemas";
import {
  createProfessionalMessage,
  deliverProfessionalMessage,
  listPatientProfessionalMessages,
  listProfessionalMessages,
} from "./messageService";
import {
  assertProfessionalMessageRetryAccess,
  ProfessionalMessageAccessUnavailableError,
} from "./messageRetryAccess";
import { getProfessionalSettingsSnapshot } from "./settingsService";
import { listProfessionalAccesses } from "./service";

export const professionalMessageRouter = router({
  templates: professionalMessagesProcedure.query(async ({ ctx }) => {
    const snapshot = await getProfessionalSettingsSnapshot(ctx.user.id);
    return snapshot.preferences.messageTemplates;
  }),
  recipients: professionalMessagesProcedure.query(async ({ ctx }) => {
    const accesses = await listProfessionalAccesses(ctx.user.id);
    return accesses
      .filter(access => access.status === "approved")
      .map(access => ({
        patientUserId: access.patientUserId,
        status: "approved" as const,
        patient: access.patient
          ? {
              name: access.patient.name,
              email: access.patient.email,
            }
          : null,
      }));
  }),
  list: professionalMessagesProcedure
    .input(professionalMessageListSchema)
    .query(({ ctx, input }) => listProfessionalMessages(ctx.user.id, input)),
  create: professionalMessagesProcedure
    .input(professionalMessageCreateSchema)
    .mutation(({ ctx, input }) =>
      createProfessionalMessage(ctx.user.id, input)
    ),
  retry: professionalMessagesProcedure
    .input(professionalMessageRetrySchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await assertProfessionalMessageRetryAccess(ctx.user.id, input.messageId);
        return await deliverProfessionalMessage(input.messageId, ctx.user.id);
      } catch (error) {
        if (error instanceof ProfessionalMessageAccessUnavailableError) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        throw error;
      }
    }),
  patientList: protectedProcedure
    .input(patientProfessionalMessageListSchema)
    .query(({ ctx, input }) =>
      listPatientProfessionalMessages(ctx.user.id, input)
    ),
});
