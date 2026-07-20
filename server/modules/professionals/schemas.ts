import { z } from "zod";
import { goalSchema } from "../goals/schemas";
import { boundedReportDateRangeSchema } from "../insights/schemas";

const patientContactSchema = z
  .string()
  .trim()
  .min(3, "Informe o e-mail ou celular do paciente.")
  .max(320);
const professionalSuggestionStatusSchema = z.enum([
  "draft",
  "sent",
  "accepted",
  "refused",
  "cancelled",
]);
const optionalRecordText = z.string().trim().max(4000).optional();
const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data no formato AAAA-MM-DD.")
  .refine(value => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Informe uma data de vigência válida.");

export const professionalProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  registrationNumber: z.string().trim().min(2).max(80).optional(),
  active: z.boolean().default(true),
});

export const requestPatientAccessSchema = z
  .object({
    patientContact: patientContactSchema.optional(),
    patientEmail: z
      .string()
      .trim()
      .email("Informe um e-mail válido do paciente.")
      .optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine(input => Boolean(input.patientContact || input.patientEmail), {
    message: "Informe o e-mail ou celular do paciente.",
    path: ["patientContact"],
  });

export const accessIdSchema = z.object({ accessId: z.string().min(1) });

export const professionalTrackingTransitionSchema = accessIdSchema.extend({
  status: z.enum(["active", "paused", "ended"]),
  reason: z.string().trim().max(1000).optional(),
});

export const patientIdSchema = z.object({
  patientId: z.number().int().positive(),
  weekOffset: z.number().int().optional().default(0),
});

export const professionalRecordSchema = z.object({
  patientId: z.number().int().positive(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(10).max(50).optional().default(20),
});

export const professionalAssessmentSchema = z.object({
  patientId: z.number().int().positive(),
  objective: z.string().trim().min(3).max(4000),
  weightKg: z.number().positive().max(700).optional(),
  heightCm: z.number().positive().max(300).optional(),
  routineAndSchedule: optionalRecordText,
  physicalActivity: optionalRecordText,
  foodPreferences: optionalRecordText,
  restrictionsAndAllergies: optionalRecordText,
  reportedDifficulties: optionalRecordText,
  relevantHabits: optionalRecordText,
  professionalObservations: optionalRecordText,
  assessedAt: z.number().int().positive(),
  nextReviewAt: z.number().int().positive().optional(),
});

export const professionalNoteSchema = z.object({
  patientId: z.number().int().positive(),
  content: z.string().trim().min(1).max(8000),
});

export const professionalGuidanceSchema = z.object({
  patientId: z.number().int().positive(),
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(3).max(8000),
  deliveryStatus: z
    .enum(["draft", "pending", "sent", "failed"])
    .default("draft"),
  supersedesGuidanceId: z.string().min(1).optional(),
});

export const professionalOfficialGoalSchema = z.object({
  patientId: z.number().int().positive(),
  expectedVersion: z.number().int().positive().optional(),
  effectiveFrom: dateKeySchema,
  justification: z.string().trim().min(3).max(2000),
  goal: goalSchema.omit({ startDate: true }),
});

export const professionalGoalNotificationRetrySchema = z.object({
  goalId: z.string().uuid(),
});

export const patientProfessionalGoalReviewSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const patientAdoptProfessionalGoalSchema = z.object({
  goalId: z.string().uuid(),
});

export const professionalPortfolioSchema = z.object({
  search: z.string().trim().max(160).optional().default(""),
  authorizationStatus: z
    .enum(["all", "pending", "approved", "rejected", "revoked"])
    .optional()
    .default("all"),
  trackingStatus: z
    .enum(["all", "not_started", "active", "paused", "ended"])
    .optional()
    .default("all"),
  activity: z
    .enum(["all", "recent", "inactive", "unavailable"])
    .optional()
    .default("all"),
  nextReview: z
    .enum(["all", "scheduled", "due_soon", "overdue", "unavailable"])
    .optional()
    .default("all"),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(10).max(50).optional().default(20),
});

export const patientPeriodBundleSchema =
  boundedReportDateRangeSchema.safeExtend({
    patientId: z.number().int().positive(),
  });

export const professionalCommentSchema = z.object({
  patientId: z.number().int().positive(),
  comment: z.string().trim().min(1).max(1000),
});

export const professionalGoalSuggestionStatusSchema =
  professionalSuggestionStatusSchema;
export const professionalGoalSuggestionSchema = z.object({
  patientId: z.number().int().positive(),
  rationale: z.string().trim().min(3).max(1000),
  status: professionalGoalSuggestionStatusSchema.default("sent"),
  goal: goalSchema,
});
export const goalSuggestionDecisionSchema = z.object({
  suggestionId: z.string().min(1),
  decision: z.enum(["accepted", "refused"]),
});
export const professionalMealSuggestionStatusSchema =
  professionalSuggestionStatusSchema;
export const professionalMealSuggestionSchema = z.object({
  patientId: z.number().int().positive(),
  mealLabel: z.string().trim().min(2).max(80),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(1500),
  rationale: z.string().trim().min(3).max(1000),
  notes: z.string().trim().max(1000).optional(),
  status: professionalMealSuggestionStatusSchema.default("sent"),
});
export const professionalPatientQuestionSchema = z.object({
  patientId: z.number().int().positive(),
  question: z.string().trim().min(3).max(800),
});
export const professionalPatientAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(3000),
  citedContext: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  caution: z.string().trim().max(500).optional(),
  educationalNotice: z.string().trim().min(1).max(500),
});

export type ProfessionalProfileInput = z.infer<
  typeof professionalProfileSchema
>;
export type RequestPatientAccessInput = z.infer<
  typeof requestPatientAccessSchema
>;
export type AccessIdInput = z.infer<typeof accessIdSchema>;
export type ProfessionalTrackingTransitionInput = z.infer<
  typeof professionalTrackingTransitionSchema
>;
export type PatientIdInput = z.infer<typeof patientIdSchema>;
export type ProfessionalRecordInput = z.infer<typeof professionalRecordSchema>;
export type ProfessionalAssessmentInput = z.infer<
  typeof professionalAssessmentSchema
>;
export type ProfessionalNoteInput = z.infer<typeof professionalNoteSchema>;
export type ProfessionalGuidanceInput = z.infer<
  typeof professionalGuidanceSchema
>;
export type ProfessionalOfficialGoalInput = z.infer<
  typeof professionalOfficialGoalSchema
>;
export type ProfessionalGoalNotificationRetryInput = z.infer<
  typeof professionalGoalNotificationRetrySchema
>;
export type PatientProfessionalGoalReviewInput = z.infer<
  typeof patientProfessionalGoalReviewSchema
>;
export type PatientAdoptProfessionalGoalInput = z.infer<
  typeof patientAdoptProfessionalGoalSchema
>;
export type ProfessionalPortfolioInput = z.infer<
  typeof professionalPortfolioSchema
>;
export type PatientPeriodBundleInput = z.infer<
  typeof patientPeriodBundleSchema
>;
export type ProfessionalCommentInput = z.infer<
  typeof professionalCommentSchema
>;
export type ProfessionalGoalSuggestionInput = z.infer<
  typeof professionalGoalSuggestionSchema
>;
export type ProfessionalGoalSuggestionStatus = z.infer<
  typeof professionalGoalSuggestionStatusSchema
>;
export type GoalSuggestionDecisionInput = z.infer<
  typeof goalSuggestionDecisionSchema
>;
export type ProfessionalMealSuggestionInput = z.infer<
  typeof professionalMealSuggestionSchema
>;
export type ProfessionalMealSuggestionStatus = z.infer<
  typeof professionalMealSuggestionStatusSchema
>;
export type ProfessionalPatientQuestionInput = z.infer<
  typeof professionalPatientQuestionSchema
>;
export type ProfessionalPatientAnswer = z.infer<
  typeof professionalPatientAnswerSchema
>;
