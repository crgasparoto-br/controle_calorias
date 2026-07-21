import { z } from "zod";
import { professionalMessageTypeSchema } from "./schemas";

const optionalTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform(value => value || undefined)
    .optional();

export const professionalIdentitySettingsSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    registrationNumber: optionalTrimmedText(80),
    contactEmail: z
      .string()
      .trim()
      .email("Informe um e-mail profissional válido.")
      .max(320)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    contactPhone: optionalTrimmedText(30),
    patientFacingBio: optionalTrimmedText(1000),
  })
  .strict();

export const professionalMessageTemplateSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(2).max(120),
    messageType: professionalMessageTypeSchema,
    content: z.string().trim().min(1).max(4000),
  })
  .strict();

export const professionalPreferencesSettingsSchema = z
  .object({
    defaultReviewIntervalDays: z.number().int().min(1).max(365).nullable(),
    messageTemplates: z.array(professionalMessageTemplateSchema).max(20),
  })
  .strict();

export const professionalActiveSettingsSchema = z
  .object({
    active: z.boolean(),
  })
  .strict();

// Não usar strict aqui: versões anteriores persistiram chaves de automação que
// nunca tiveram consumidor. A leitura as descarta e a próxima gravação converge
// para o contrato atual sem exigir migration destrutiva.
export const storedProfessionalSettingsSchema = z.object({
  version: z.literal(1),
  contactEmail: z.string().email().max(320).nullable(),
  contactPhone: z.string().max(30).nullable(),
  patientFacingBio: z.string().max(1000).nullable(),
  defaultReviewIntervalDays: z.number().int().min(1).max(365).nullable(),
  messageTemplates: z
    .array(professionalMessageTemplateSchema.extend({ id: z.string().uuid() }))
    .max(20),
  updatedAt: z.number().int().positive(),
});

export type ProfessionalIdentitySettingsInput = z.infer<
  typeof professionalIdentitySettingsSchema
>;
export type ProfessionalPreferencesSettingsInput = z.infer<
  typeof professionalPreferencesSettingsSchema
>;
export type StoredProfessionalSettings = z.infer<
  typeof storedProfessionalSettingsSchema
>;
