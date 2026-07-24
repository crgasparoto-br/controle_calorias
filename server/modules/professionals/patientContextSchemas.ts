import { z } from "zod";

export const professionalPatientContextResourceSchema = z.enum([
  "professional_record",
  "professional_reports",
  "professional_messages",
]);

export const professionalPatientContextSchema = z.object({
  patientId: z.number().int().positive(),
  resource: professionalPatientContextResourceSchema,
});

export type ProfessionalPatientContextInput = z.infer<
  typeof professionalPatientContextSchema
>;
