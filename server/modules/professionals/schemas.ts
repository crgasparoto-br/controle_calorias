import { z } from "zod";
import { goalSchema } from "../goals/schemas";

export const professionalProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  registrationNumber: z.string().trim().min(2).max(80).optional(),
});

export const requestPatientAccessSchema = z.object({
  patientId: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

export const accessIdSchema = z.object({
  accessId: z.string().min(1),
});

export const patientIdSchema = z.object({
  patientId: z.number().int().positive(),
});

export const professionalCommentSchema = z.object({
  patientId: z.number().int().positive(),
  comment: z.string().trim().min(1).max(1000),
});

export const professionalGoalSuggestionSchema = z.object({
  patientId: z.number().int().positive(),
  rationale: z.string().trim().min(3).max(1000),
  goal: goalSchema,
});

export type ProfessionalProfileInput = z.infer<typeof professionalProfileSchema>;
export type RequestPatientAccessInput = z.infer<typeof requestPatientAccessSchema>;
export type AccessIdInput = z.infer<typeof accessIdSchema>;
export type PatientIdInput = z.infer<typeof patientIdSchema>;
export type ProfessionalCommentInput = z.infer<typeof professionalCommentSchema>;
export type ProfessionalGoalSuggestionInput = z.infer<typeof professionalGoalSuggestionSchema>;

