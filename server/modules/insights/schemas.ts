import { z } from "zod";

export const reportsPeriodSchema = z
  .object({
    weekOffset: z.number().int().min(-1).max(0).default(0),
  })
  .optional();
