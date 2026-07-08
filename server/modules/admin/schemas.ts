import { z } from "zod";

export const updateWhatsappTokenSchema = z.object({
  accessToken: z.string().min(20).max(4096),
});

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

export type UpdateWhatsappTokenInput = z.infer<typeof updateWhatsappTokenSchema>;
export type RunFoodImportJobInput = z.infer<typeof runFoodImportJobSchema>;
