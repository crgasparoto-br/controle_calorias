import { z } from "zod";

export function calculateAgeYearsFromBirthDate(birthDate: string, referenceDate = new Date()) {
  const parts = birthDate.split("-").map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;

  const parsedDate = new Date(year, month - 1, day);
  const isSameDate = parsedDate.getFullYear() === year && parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day;
  if (!isSameDate || parsedDate.getTime() > referenceDate.getTime()) return null;

  let age = referenceDate.getFullYear() - year;
  const birthdayAlreadyHappened = referenceDate.getMonth() > month - 1 || (referenceDate.getMonth() === month - 1 && referenceDate.getDate() >= day);
  if (!birthdayAlreadyHappened) age -= 1;

  return age;
}

const onboardingBaseSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  birthDate: z.string().trim().min(1, "Informe sua data de nascimento."),
  heightCm: z.number().min(100).max(250),
  currentWeightKg: z.number().min(25).max(350),
  weightMeasuredAt: z.string().datetime().optional(),
  weightEntryNote: z.string().trim().max(200).optional(),
  objective: z.enum(["emagrecer", "manter_peso", "ganhar_massa", "melhorar_habitos"]),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  trackingExperience: z.enum(["beginner", "intermediate", "advanced"]),
  dietaryPreferences: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  dietaryRestrictions: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  eatingRoutine: z.enum(["cozinha_em_casa", "come_fora", "delivery", "marmita", "misto"]),
  mainDifficulty: z.enum(["fome", "ansiedade", "falta_de_tempo", "beliscos", "doces", "comer_fora", "falta_de_planejamento"]),
});

export const onboardingSchema = onboardingBaseSchema
  .superRefine((input, ctx) => {
    const ageYears = calculateAgeYearsFromBirthDate(input.birthDate);
    if (ageYears === null) {
      ctx.addIssue({ code: "custom", path: ["birthDate"], message: "Informe uma data de nascimento válida." });
      return;
    }

    if (ageYears < 13 || ageYears > 120) {
      ctx.addIssue({ code: "custom", path: ["birthDate"], message: "A idade calculada deve estar entre 13 e 120 anos." });
    }
  })
  .transform(input => ({
    ...input,
    ageYears: calculateAgeYearsFromBirthDate(input.birthDate) ?? 0,
  }));

export type OnboardingInput = z.infer<typeof onboardingSchema>;
