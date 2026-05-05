import { z } from "zod";

export const onboardingSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  ageYears: z.number().int().min(13).max(120),
  heightCm: z.number().min(100).max(250),
  currentWeightKg: z.number().min(25).max(350),
  objective: z.enum(["emagrecer", "manter_peso", "ganhar_massa", "melhorar_habitos"]),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  trackingExperience: z.enum(["beginner", "intermediate", "advanced"]),
  dietaryPreferences: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  dietaryRestrictions: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  eatingRoutine: z.enum(["cozinha_em_casa", "come_fora", "delivery", "marmita", "misto"]),
  mainDifficulty: z.enum(["fome", "ansiedade", "falta_de_tempo", "beliscos", "doces", "comer_fora", "falta_de_planejamento"]),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
