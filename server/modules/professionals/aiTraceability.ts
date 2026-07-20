import type { ProfessionalAiAssistantOutput } from "./aiSchemas";

export type ProfessionalAiSourceSignal = {
  key: string;
  label: string;
  value: string;
  period: "current" | "previous";
};

type ProfessionalAiContext = {
  period: { startDate: string; endDate: string; dayCount?: number };
  totals: {
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
  };
  plannedMacros: {
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
  };
  adherence: {
    percent: number;
    daysWithinRange: number;
    daysAboveRange: number;
    daysBelowRange: number;
    daysWithoutRecords: number;
  };
  recordFrequency: {
    daysWithRecords: number;
    daysWithoutRecords: number;
    totalDays: number;
  };
  weekdays: {
    totalDays: number;
    daysWithRecords: number;
    averageCalories: number;
    averageGoalCalories: number;
  };
  weekends: {
    totalDays: number;
    daysWithRecords: number;
    averageCalories: number;
    averageGoalCalories: number;
  };
  weight: {
    hasData: boolean;
    firstWeightKg: number | null;
    lastWeightKg: number | null;
    deltaKg: number | null;
  };
  water: {
    totalConsumedMl: number;
    totalGoalMl: number;
    goalHitDays: number;
    averageDailyMl: number;
  };
  exercise: {
    totalCalories: number;
    totalDurationMinutes: number;
    activeDays: number;
  };
  foodQuality: {
    hasData: boolean;
    daysWithRecords: number;
    qualityIndex: number | null;
    ultraProcessedCaloriesPercent: number;
    naturalOrMinimallyProcessedCaloriesPercent: number;
  };
  alerts: Array<{
    label: string;
    severity: string;
    periodStart: number | null;
    periodEnd: number | null;
  }>;
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function signal(
  prefix: "current" | "previous",
  key: string,
  label: string,
  value: string
): ProfessionalAiSourceSignal {
  return {
    key: `${prefix}_${key}`,
    label: `${prefix === "current" ? "Período atual" : "Período anterior"} · ${label}`,
    value,
    period: prefix,
  };
}

function contextSignals(
  context: ProfessionalAiContext,
  prefix: "current" | "previous"
): ProfessionalAiSourceSignal[] {
  const signals: ProfessionalAiSourceSignal[] = [
    signal(
      prefix,
      "period",
      "Intervalo",
      `${context.period.startDate} a ${context.period.endDate}`
    ),
    signal(
      prefix,
      "record_frequency",
      "Frequência de registros",
      `${context.recordFrequency.daysWithRecords} com registros | ${context.recordFrequency.daysWithoutRecords} sem registros | ${context.recordFrequency.totalDays} dias no total`
    ),
    signal(
      prefix,
      "adherence",
      "Aderência calórica",
      `${round(context.adherence.percent)}% | ${context.adherence.daysWithinRange} dentro | ${context.adherence.daysAboveRange} acima | ${context.adherence.daysBelowRange} abaixo | ${context.adherence.daysWithoutRecords} sem registros`
    ),
    signal(
      prefix,
      "calories",
      "Calorias realizadas",
      `${round(context.totals.calories)} kcal`
    ),
    signal(
      prefix,
      "macros",
      "Macronutrientes realizados e planejados",
      `Realizados: P ${round(context.totals.proteinGrams)} g | C ${round(context.totals.carbsGrams)} g | G ${round(context.totals.fatGrams)} g; planejados: P ${round(context.plannedMacros.proteinGrams)} g | C ${round(context.plannedMacros.carbsGrams)} g | G ${round(context.plannedMacros.fatGrams)} g`
    ),
    signal(
      prefix,
      "weekdays",
      "Dias úteis",
      `${context.weekdays.daysWithRecords} de ${context.weekdays.totalDays} dias com registros | média ${round(context.weekdays.averageCalories)} kcal | meta média ${round(context.weekdays.averageGoalCalories)} kcal`
    ),
    signal(
      prefix,
      "weekends",
      "Finais de semana",
      `${context.weekends.daysWithRecords} de ${context.weekends.totalDays} dias com registros | média ${round(context.weekends.averageCalories)} kcal | meta média ${round(context.weekends.averageGoalCalories)} kcal`
    ),
    signal(
      prefix,
      "water",
      "Água",
      `${round(context.water.totalConsumedMl)} ml consumidos | ${round(context.water.totalGoalMl)} ml de meta | ${context.water.goalHitDays} dias com meta atingida | média ${round(context.water.averageDailyMl)} ml/dia`
    ),
    signal(
      prefix,
      "exercise",
      "Exercícios",
      `${context.exercise.activeDays} dias ativos | ${round(context.exercise.totalDurationMinutes)} min | ${round(context.exercise.totalCalories)} kcal`
    ),
    signal(
      prefix,
      "weight",
      "Evolução de peso",
      context.weight.hasData
        ? `${context.weight.firstWeightKg ?? "-"} kg → ${context.weight.lastWeightKg ?? "-"} kg | variação ${context.weight.deltaKg ?? "-"} kg`
        : "Sem dados de peso no período"
    ),
    signal(
      prefix,
      "food_quality",
      "Qualidade alimentar",
      context.foodQuality.hasData
        ? `${context.foodQuality.daysWithRecords} dias avaliados | índice ${context.foodQuality.qualityIndex ?? "-"} | ultraprocessados ${round(context.foodQuality.ultraProcessedCaloriesPercent)}% | naturais/minimamente processados ${round(context.foodQuality.naturalOrMinimallyProcessedCaloriesPercent)}%`
        : "Sem dados suficientes para calcular qualidade alimentar"
    ),
    signal(
      prefix,
      "alerts",
      "Alertas objetivos",
      context.alerts.length
        ? context.alerts
            .map(alert => `${alert.label} (${alert.severity})`)
            .join(", ")
        : "Nenhum alerta objetivo aberto no período"
    ),
  ];

  return signals;
}

export function buildProfessionalAiSourceSignals(
  current: ProfessionalAiContext,
  previous?: ProfessionalAiContext
) {
  return [
    ...contextSignals(current, "current"),
    ...(previous ? contextSignals(previous, "previous") : []),
  ];
}

export function validateProfessionalAiSourceReferences(
  output: ProfessionalAiAssistantOutput,
  sourceSignals: ProfessionalAiSourceSignal[]
) {
  const availableKeys = new Set(sourceSignals.map(source => source.key));
  const referencedKeys = [
    ...output.summarySourceKeys,
    ...output.factSourceKeys.flat(),
    ...output.interpretationSourceKeys.flat(),
  ];

  if (referencedKeys.some(key => !availableKeys.has(key))) {
    throw new Error("professional_ai_unknown_source_reference");
  }
}
