export type NutritionGoalSafetyTarget = {
  label: string;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

export type NutritionGoalSafetyIssue = {
  code:
    | "calories_too_low"
    | "calories_low"
    | "calories_high"
    | "calories_too_high"
    | "protein_too_low"
    | "protein_high"
    | "carbs_low"
    | "fat_too_low"
    | "fat_low"
    | "fat_high"
    | "macro_energy_mismatch";
  severity: "block" | "warning";
  targetLabel: string;
  message: string;
};

export type NutritionGoalSafetyAssessment = {
  issues: NutritionGoalSafetyIssue[];
  blockers: NutritionGoalSafetyIssue[];
  warnings: NutritionGoalSafetyIssue[];
};

const MIN_CALORIES = 1200;
const LOW_CALORIES_WARNING = 1500;
const HIGH_CALORIES_WARNING = 4000;
const MAX_CALORIES = 5000;
const MIN_PROTEIN_GRAMS = 30;
const HIGH_PROTEIN_GRAMS_WARNING = 250;
const LOW_CARBS_GRAMS_WARNING = 50;
const MIN_FAT_GRAMS = 20;
const LOW_FAT_GRAMS_WARNING = 30;
const HIGH_FAT_GRAMS_WARNING = 180;
const MACRO_ENERGY_MISMATCH_RATIO = 0.2;

function buildIssue(
  severity: NutritionGoalSafetyIssue["severity"],
  code: NutritionGoalSafetyIssue["code"],
  targetLabel: string,
  message: string,
): NutritionGoalSafetyIssue {
  return { severity, code, targetLabel, message };
}

function assessTarget(target: NutritionGoalSafetyTarget): NutritionGoalSafetyIssue[] {
  const issues: NutritionGoalSafetyIssue[] = [];
  const label = target.label;

  if (target.calories < MIN_CALORIES) {
    issues.push(buildIssue(
      "block",
      "calories_too_low",
      label,
      `${label}: metas abaixo de ${MIN_CALORIES} kcal/dia não podem ser salvas aqui. Ajuste para um valor mais seguro ou combine um plano individual com um profissional.`,
    ));
  } else if (target.calories < LOW_CALORIES_WARNING) {
    issues.push(buildIssue(
      "warning",
      "calories_low",
      label,
      `${label}: a meta calórica está em uma faixa baixa. Observe energia, fome e rotina antes de manter esse planejamento por vários dias.`,
    ));
  }

  if (target.calories > MAX_CALORIES) {
    issues.push(buildIssue(
      "block",
      "calories_too_high",
      label,
      `${label}: metas acima de ${MAX_CALORIES} kcal/dia precisam de acompanhamento individual antes de serem usadas no app.`,
    ));
  } else if (target.calories > HIGH_CALORIES_WARNING) {
    issues.push(buildIssue(
      "warning",
      "calories_high",
      label,
      `${label}: a meta calórica está alta. Revise se ela combina com seu objetivo, apetite e rotina de treino.`,
    ));
  }

  if (target.proteinGrams < MIN_PROTEIN_GRAMS) {
    issues.push(buildIssue(
      "block",
      "protein_too_low",
      label,
      `${label}: proteína abaixo de ${MIN_PROTEIN_GRAMS} g/dia não pode ser salva como meta. Ajuste para uma referência mais consistente.`,
    ));
  } else if (target.proteinGrams > HIGH_PROTEIN_GRAMS_WARNING) {
    issues.push(buildIssue(
      "warning",
      "protein_high",
      label,
      `${label}: a meta de proteína está elevada. Vale conferir se esse número faz sentido para sua rotina e orientação profissional.`,
    ));
  }

  if (target.carbsGrams < LOW_CARBS_GRAMS_WARNING) {
    issues.push(buildIssue(
      "warning",
      "carbs_low",
      label,
      `${label}: carboidratos estão em uma faixa baixa. Se essa for uma escolha intencional, acompanhe energia, treino e bem-estar.`,
    ));
  }

  if (target.fatGrams < MIN_FAT_GRAMS) {
    issues.push(buildIssue(
      "block",
      "fat_too_low",
      label,
      `${label}: gorduras abaixo de ${MIN_FAT_GRAMS} g/dia não podem ser salvas aqui. Ajuste para uma faixa mais segura.`,
    ));
  } else if (target.fatGrams < LOW_FAT_GRAMS_WARNING) {
    issues.push(buildIssue(
      "warning",
      "fat_low",
      label,
      `${label}: gorduras estão em uma faixa baixa. Revise se a meta é sustentável para sua rotina.`,
    ));
  } else if (target.fatGrams > HIGH_FAT_GRAMS_WARNING) {
    issues.push(buildIssue(
      "warning",
      "fat_high",
      label,
      `${label}: a meta de gorduras está elevada. Revise a distribuição dos macronutrientes com calma.`,
    ));
  }

  const macroCalories = target.proteinGrams * 4 + target.carbsGrams * 4 + target.fatGrams * 9;
  const mismatchRatio = target.calories > 0 ? Math.abs(macroCalories - target.calories) / target.calories : 0;
  if (mismatchRatio > MACRO_ENERGY_MISMATCH_RATIO) {
    issues.push(buildIssue(
      "warning",
      "macro_energy_mismatch",
      label,
      `${label}: calorias e macronutrientes estão desalinhados. Ajuste os números para deixar a meta mais fácil de acompanhar.`,
    ));
  }

  return issues;
}

export function assessNutritionGoalTargets(targets: NutritionGoalSafetyTarget[]): NutritionGoalSafetyAssessment {
  const issues = targets.flatMap(assessTarget);
  return {
    issues,
    blockers: issues.filter(issue => issue.severity === "block"),
    warnings: issues.filter(issue => issue.severity === "warning"),
  };
}

export function assessNutritionGoalInput(input: {
  defaultGoal: Omit<NutritionGoalSafetyTarget, "label">;
  exceptions: Array<Omit<NutritionGoalSafetyTarget, "label"> & { weekday: number }>;
}): NutritionGoalSafetyAssessment {
  return assessNutritionGoalTargets([
    { label: "Meta geral", ...input.defaultGoal },
    ...input.exceptions.map(exception => ({
      label: `Exceção do dia ${exception.weekday + 1}`,
      ...exception,
    })),
  ]);
}
