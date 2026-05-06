import { z } from "zod";

export const gamificationSettingsSchema = z.object({
  enabled: z.boolean(),
});
