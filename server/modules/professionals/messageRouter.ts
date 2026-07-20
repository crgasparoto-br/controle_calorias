import { protectedProcedure, router } from "../../_core/trpc";
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
  list: protectedProcedure
    .input(professionalMessageListSchema)
    .query(({ ctx, input }) => listProfessionalMessages(ctx.user.id, input)),
  create: protectedProcedure
    .input(professionalMessageCreateSchema)
    .mutation(({ ctx, input }) =>
      createProfessionalMessage(ctx.user.id, input)
    ),
  retry: protectedProcedure
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
