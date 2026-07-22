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

export const professionalMessageRouter = router({
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
