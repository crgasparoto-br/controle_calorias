import { z } from "zod";

export const updateWhatsappTokenSchema = z.object({
  accessToken: z.string().min(20).max(4096),
});

export type UpdateWhatsappTokenInput = z.infer<typeof updateWhatsappTokenSchema>;
