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
import { getProfessionalSettingsSnapshot } from "./settingsService";
import { listProfessionalAccesses } from "./service";

export const professionalMessageRouter = router({
  templates: professionalMessagesProcedure.query(async ({ ctx }) => {
    const snapshot = await getProfessionalSettingsSnapshot(ctx.user.id);
    return snapshot.preferences.messageTemplates;
  }),
  recipients: professionalMessagesProcedure.query(({ ctx }) =>
    listProfessionalAccesses(ctx.user.id)
  ),
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
    .mutation(({ ctx, input }) =>
      deliverProfessionalMessage(input.messageId, ctx.user.id)
    ),
  patientList: protectedProcedure
    .input(patientProfessionalMessageListSchema)
    .query(({ ctx, input }) =>
      listPatientProfessionalMessages(ctx.user.id, input)
    ),
});
