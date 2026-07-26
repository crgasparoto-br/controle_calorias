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

export const professionalPatientContextOutputSchema = z
  .object({
    patientId: z.number().int().positive(),
    authorizationId: z.string().min(1).optional(),
    displayName: z.string().min(1),
    authorizationStatus: z.literal("approved"),
    lastActivityAt: z.number().int().nonnegative().nullable().optional(),
    nextReviewAt: z.number().int().nonnegative().nullable().optional(),
    trackingStatus: z.enum(["not_started", "active", "paused", "ended"]),
  })
  .strict();

export type ProfessionalPatientContextInput = z.infer<
  typeof professionalPatientContextSchema
>;
