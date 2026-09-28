import { z } from "zod";

export const updateWhatsappTokenSchema = z.object({
  accessToken: z.string().min(20).max(4096),
});

export const adminActivitiesSchema = z.object({
  search: z.string().trim().max(120).default(""),
  period: z.enum(["today", "24h", "7d", "30d"]).default("7d"),
  status: z.enum(["all", "success", "warning", "error"]).default("all"),
  origin: z.enum(["all", "web", "whatsapp", "admin"]).default("all"),
  eventTypeCategory: z
    .enum([
      "all",
      "ai",
      "meal",
      "whatsapp",
      "foods",
      "water",
      "exercise",
      "system",
    ])
    .default("all"),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export type AdminActivitiesInput = z.infer<typeof adminActivitiesSchema>;

const csvImportFields = {
  csvContent: z.string().min(10).max(8_000_000),
  fileName: z.string().max(255).optional(),
  sourceVersion: z.string().trim().min(1).max(80),
  sourceReference: z.string().trim().min(1).max(255).optional(),
};

const optionalVersionCsvImportFields = {
  ...csvImportFields,
  sourceVersion: z.string().trim().min(1).max(80).optional(),
};

export const runFoodImportJobSchema = z.discriminatedUnion("job", [
  z.object({
    job: z.literal("seed_common_br"),
  }),
  z.object({
    job: z.literal("import_taco"),
    ...optionalVersionCsvImportFields,
  }),
  z.object({
    job: z.literal("import_tbca"),
    ...optionalVersionCsvImportFields,
  }),
]);

export const previewFoodImportJobSchema = z.discriminatedUnion("job", [
  z.object({ job: z.literal("import_taco"), ...csvImportFields }),
  z.object({ job: z.literal("import_tbca"), ...csvImportFields }),
]);

export const publishFoodImportJobSchema = z.discriminatedUnion("job", [
  z.object({
    job: z.literal("import_taco"),
    ...csvImportFields,
    previewHash: z.string().regex(/^[a-f0-9]{64}$/i),
    confirmPreview: z.literal(true),
  }),
  z.object({
    job: z.literal("import_tbca"),
    ...csvImportFields,
    previewHash: z.string().regex(/^[a-f0-9]{64}$/i),
    confirmPreview: z.literal(true),
  }),
]);

export const nutritionLabelReviewQueueSchema = z.object({
  status: z
    .enum([
      "all",
      "pending_review",
      "photo_requested",
      "photo_received",
      "processing",
      "error_retryable",
      "evidence_unreadable",
      "identity_conflict",
    ])
    .default("all"),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const updateNutritionLabelCandidateSchema = z.object({
  candidateId: z.number().int().positive(),
  foodName: z.string().trim().min(1).max(255),
  canonicalName: z.string().trim().min(1).max(255),
  brand: z.string().trim().max(255).nullable(),
  productVariant: z.string().trim().max(255).nullable(),
  barcode: z.string().trim().max(32).nullable(),
  servingLabel: z.string().trim().min(1).max(120),
  servingUnit: z.string().trim().min(1).max(40),
  gramsPerServing: z.number().finite().positive().max(100_000),
  calories: z.number().finite().min(0).max(100_000),
  protein: z.number().finite().min(0).max(100_000),
  carbs: z.number().finite().min(0).max(100_000),
  fat: z.number().finite().min(0).max(100_000),
  fiber: z.number().finite().min(0).max(100_000).nullable(),
});

export type UpdateWhatsappTokenInput = z.infer<
  typeof updateWhatsappTokenSchema
>;
export type RunFoodImportJobInput = z.infer<typeof runFoodImportJobSchema>;
export type PreviewFoodImportJobInput = z.infer<
  typeof previewFoodImportJobSchema
>;
export type PublishFoodImportJobInput = z.infer<
  typeof publishFoodImportJobSchema
>;
export type UpdateNutritionLabelCandidateInput = z.infer<
  typeof updateNutritionLabelCandidateSchema
>;
