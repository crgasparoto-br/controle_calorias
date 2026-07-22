import { z } from "zod";

export const professionalAiModeSchema = z.enum([
  "summary",
  "comparison",
  "question",
  "draft",
]);

export const professionalAiDraftTypeSchema = z.enum([
  "guidance",
  "reminder",
  "weigh_in_request",
  "record_request",
  "administrative",
  "follow_up_summary",
]);

export const professionalAiQuestionFocusSchema = z.enum([
  "overview",
  "records",
  "adherence",
  "macros",
  "water",
  "exercise",
  "weight",
  "food_quality",
  "alerts",
  "clinical_boundary",
]);

export const professionalAiQuestionFocusOutputSchema = z
  .object({ focus: professionalAiQuestionFocusSchema })
  .strict();

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PERIOD_DAYS = 90;

function dateDayNumber(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return Number.NaN;
  }
  return Math.floor(date.getTime() / 86_400_000);
}

export const professionalAiGenerateSchema = z
  .object({
    patientId: z.number().int().positive(),
    startDate: z.string().regex(DATE_KEY_PATTERN),
    endDate: z.string().regex(DATE_KEY_PATTERN),
    mode: professionalAiModeSchema,
    question: z.string().trim().max(1_000).optional(),
    draftType: professionalAiDraftTypeSchema.optional(),
  })
  .superRefine((input, context) => {
    const startDay = dateDayNumber(input.startDate);
    const endDay = dateDayNumber(input.endDate);
    if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startDate"],
        message: "Informe um período válido.",
      });
      return;
    }
    if (endDay < startDay) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "A data final deve ser igual ou posterior à data inicial.",
      });
    }
    if (endDay - startDay + 1 > MAX_PERIOD_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: `O período máximo para assistência por IA é de ${MAX_PERIOD_DAYS} dias.`,
      });
    }
    if (input.mode === "question" && !input.question?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["question"],
        message: "Escreva a pergunta que deseja analisar.",
      });
    }
    if (input.mode === "draft" && !input.draftType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["draftType"],
        message: "Selecione o tipo de rascunho.",
      });
    }
  });

export const professionalAiPrioritySchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

const professionalAiDraftSchema = z.object({
  messageType: professionalAiDraftTypeSchema,
  content: z.string().trim().min(1).max(4_000),
});

const sourceReferenceListSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(12);

export const professionalAiAssistantOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(2_000),
    summarySourceKeys: sourceReferenceListSchema,
    facts: z.array(z.string().trim().min(1).max(500)).max(12),
    factSourceKeys: z.array(sourceReferenceListSchema).max(12),
    interpretations: z.array(z.string().trim().min(1).max(500)).max(8),
    interpretationSourceKeys: z.array(sourceReferenceListSchema).max(8),
    missingData: z.array(z.string().trim().min(1).max(300)).max(12),
    cautions: z.array(z.string().trim().min(1).max(500)).max(8),
    draft: professionalAiDraftSchema.nullable(),
    educationalNotice: z.string().trim().min(1).max(800),
  })
  .superRefine((output, context) => {
    if (output.factSourceKeys.length !== output.facts.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["factSourceKeys"],
        message: "Cada fato precisa indicar suas fontes.",
      });
    }
    if (output.interpretationSourceKeys.length !== output.interpretations.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interpretationSourceKeys"],
        message: "Cada interpretação precisa indicar suas fontes.",
      });
    }
  });

export type ProfessionalAiGenerateInput = z.infer<
  typeof professionalAiGenerateSchema
>;
export type ProfessionalAiDraftType = z.infer<
  typeof professionalAiDraftTypeSchema
>;
export type ProfessionalAiQuestionFocus = z.infer<
  typeof professionalAiQuestionFocusSchema
>;
export type ProfessionalAiAssistantOutput = z.infer<
  typeof professionalAiAssistantOutputSchema
>;
