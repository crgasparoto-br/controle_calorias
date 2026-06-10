import { z } from "zod";
import { onboardingSchema } from "./schemas";

const requiredConsent = (message: string) => z.boolean().refine(value => value === true, { message });

export const whatsappOnboardingTokenSchema = z.object({
  token: z.string().trim().min(24).max(160),
});

export const whatsappOnboardingConsentSchema = z.object({
  acceptedTerms: requiredConsent("Aceite os termos de uso para concluir o cadastro."),
  acceptedPrivacyPolicy: requiredConsent("Aceite a política de privacidade para concluir o cadastro."),
  acceptedHealthDataProcessing: requiredConsent("Autorize o tratamento dos dados necessários ao serviço."),
  acceptedOperationalWhatsapp: requiredConsent("Autorize as mensagens operacionais pelo WhatsApp para usar este canal."),
  acceptedMarketingWhatsapp: z.boolean().default(false),
});

export const whatsappOnboardingCompleteSchema = whatsappOnboardingTokenSchema.extend({
  email: z.string().trim().email("Informe um e-mail válido.").max(320),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres.").max(128),
  profile: onboardingSchema,
  consents: whatsappOnboardingConsentSchema,
});

export type WhatsappOnboardingCompleteInput = z.infer<typeof whatsappOnboardingCompleteSchema>;
export type WhatsappOnboardingConsents = z.infer<typeof whatsappOnboardingConsentSchema>;
