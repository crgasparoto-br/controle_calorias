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

export const runFoodImportJobSchema = z.discriminatedUnion("job", [
  z.object({
    job: z.literal("seed_common_br"),
  }),
  z.object({
    job: z.literal("import_taco"),
    csvContent: z.string().min(10).max(8_000_000),
    fileName: z.string().max(255).optional(),
    sourceVersion: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    job: z.literal("import_tbca"),
    csvContent: z.string().min(10).max(8_000_000),
    fileName: z.string().max(255).optional(),
    sourceVersion: z.string().trim().min(1).max(120).optional(),
  }),
]);

export type UpdateWhatsappTokenInput = z.infer<
  typeof updateWhatsappTokenSchema
>;
export type RunFoodImportJobInput = z.infer<typeof runFoodImportJobSchema>;
