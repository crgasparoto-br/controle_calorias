import { z } from "zod";

export const ownerDateTimeLocalSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, "Informe uma data e um horário local válidos.")
  .max(19);
