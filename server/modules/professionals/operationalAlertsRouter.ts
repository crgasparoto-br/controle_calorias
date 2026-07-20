import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import {
  cancelProfessionalOperationalRequest,
  closeProfessionalOperationalAlert,
  createProfessionalOperationalRequest,
  evaluateProfessionalOperationalAlerts,
  listProfessionalOperationalAlerts,
  registerProfessionalReviewSignal,
  respondToProfessionalOperationalRequest,
} from "./operationalAlertsService";

const patientSchema = z.object({
  patientId: z.number().int().positive().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(input => Boolean(input.startDate) === Boolean(input.endDate), {
  message: "Informe o início e o fim do período.",
});

const closeSchema = z.object({
  alertId: z.string().uuid(),
  decision: z.enum(["resolved", "dismissed"]),
  note: z.string().trim().max(500).optional(),
});

const requestSchema = z.object({
  patientId: z.number().int().positive(),
  type: z.enum(["weigh_in", "professional_request"]),
  title: z.string().trim().min(3).max(160),
  dueAt: z.number().int().positive(),
});

const requestResponseSchema = z.object({
  requestId: z.string().uuid(),
  responseReference: z.string().trim().min(1).max(191),
});

const requestCancellationSchema = z.object({
  requestId: z.string().uuid(),
});

const reviewSignalSchema = z.object({
  patientId: z.number().int().positive(),
  originType: z.string().trim().min(2).max(80),
  originId: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(3).max(500),
});

export const professionalOperationalAlertsRouter = router({
  list: protectedProcedure
    .input(patientSchema.optional())
    .query(({ ctx, input }) =>
      listProfessionalOperationalAlerts(ctx.user.id, input?.patientId, input?.startDate && input?.endDate ? { startDate: input.startDate, endDate: input.endDate } : undefined)
    ),
  evaluate: protectedProcedure.mutation(({ ctx }) =>
    evaluateProfessionalOperationalAlerts(ctx.user.id)
  ),
  close: protectedProcedure.input(closeSchema).mutation(({ ctx, input }) =>
    closeProfessionalOperationalAlert(
      ctx.user.id,
      ctx.user.id,
      input.alertId,
      input.decision,
      input.note
    )
  ),
  createRequest: protectedProcedure
    .input(requestSchema)
    .mutation(({ ctx, input }) =>
      createProfessionalOperationalRequest(ctx.user.id, input)
    ),
  respondRequest: protectedProcedure
    .input(requestResponseSchema)
    .mutation(({ ctx, input }) =>
      respondToProfessionalOperationalRequest(
        ctx.user.id,
        input.requestId,
        input.responseReference
      )
    ),
  cancelRequest: protectedProcedure
    .input(requestCancellationSchema)
    .mutation(({ ctx, input }) =>
      cancelProfessionalOperationalRequest(
        ctx.user.id,
        ctx.user.id,
        input.requestId
      )
    ),
  registerReviewSignal: protectedProcedure
    .input(reviewSignalSchema)
    .mutation(({ ctx, input }) =>
      registerProfessionalReviewSignal(ctx.user.id, input)
    ),
});
