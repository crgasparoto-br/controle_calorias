import { protectedProcedure, router } from "../../_core/trpc";
import {
  professionalAssessmentSchema,
  professionalGuidanceSchema,
  professionalNoteSchema,
  professionalRecordSchema,
} from "./schemas";
import {
  createProfessionalGuidance,
  createProfessionalNote,
  getProfessionalRecord,
  listPatientProfessionalGuidances,
  saveProfessionalAssessment,
} from "./recordService";

export const professionalRecordRouter = router({
  get: protectedProcedure
    .input(professionalRecordSchema)
    .query(({ ctx, input }) => getProfessionalRecord(ctx.user.id, input)),
  saveAssessment: protectedProcedure
    .input(professionalAssessmentSchema)
    .mutation(({ ctx, input }) => saveProfessionalAssessment(ctx.user.id, input)),
  createNote: protectedProcedure
    .input(professionalNoteSchema)
    .mutation(({ ctx, input }) => createProfessionalNote(ctx.user.id, input)),
  createGuidance: protectedProcedure
    .input(professionalGuidanceSchema)
    .mutation(({ ctx, input }) => createProfessionalGuidance(ctx.user.id, input)),
  patientGuidances: protectedProcedure.query(({ ctx }) =>
    listPatientProfessionalGuidances(ctx.user.id)
  ),
});
