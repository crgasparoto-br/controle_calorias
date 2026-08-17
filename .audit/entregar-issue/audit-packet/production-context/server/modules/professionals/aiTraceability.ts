import type { ProfessionalAiContext } from "./aiContext";
import type { ProfessionalAiAssistantOutput } from "./aiSchemas";

export type ProfessionalAiSourceSignal = {
  key: string;
  label: string;
  value: string;
  period: "current" | "previous";
  available: boolean;
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function signal(
  prefix: "current" | "previous",
  key: string,
  label: string,
  value: string,
  available = true
): ProfessionalAiSourceSignal {
  return {
    key: `${prefix}_${key}`,
    label: `${prefix === "current" ? "Período atual" : "Período anterior"} · ${label}`,
    value,
    period: prefix,
    available,
  };
}

function contextSignals(
  context: ProfessionalAiContext,
  prefix: "current" | "previous"
): ProfessionalAiSourceSignal[] {
  const hasRecords = context.recordFrequency.daysWithRecords > 0;
  return [
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
      hasRecords
        ? `${round(context.adherence.percent)}% | ${context.adherence.daysWithinRange} dentro | ${context.adherence.daysAboveRange} acima | ${context.adherence.daysBelowRange} abaixo | ${context.adherence.daysWithoutRecords} sem registros`
        : "Indisponível por ausência de registros alimentares",
      hasRecords
    ),
    signal(
      prefix,
      "calories",
      "Calorias realizadas",
      hasRecords
        ? `${round(context.totals.calories)} kcal`
        : "Indisponível por ausência de registros alimentares",
      hasRecords
    ),
    signal(
      prefix,
      "macros",
      "Macronutrientes realizados e planejados",
      hasRecords
        ? `Realizados: P ${round(context.totals.proteinGrams)} g | C ${round(context.totals.carbsGrams)} g | G ${round(context.totals.fatGrams)} g; planejados: P ${round(context.plannedMacros.proteinGrams)} g | C ${round(context.plannedMacros.carbsGrams)} g | G ${round(context.plannedMacros.fatGrams)} g`
        : "Indisponível por ausência de registros alimentares",
      hasRecords
    ),
    signal(
      prefix,
      "weekdays",
      "Dias úteis",
      context.weekdays.daysWithRecords > 0
        ? `${context.weekdays.daysWithRecords} de ${context.weekdays.totalDays} dias com registros | média ${round(context.weekdays.averageCalories)} kcal | meta média ${round(context.weekdays.averageGoalCalories)} kcal`
        : "Sem registros alimentares em dias úteis",
      context.weekdays.daysWithRecords > 0
    ),
    signal(
      prefix,
      "weekends",
      "Finais de semana",
      context.weekends.daysWithRecords > 0
        ? `${context.weekends.daysWithRecords} de ${context.weekends.totalDays} dias com registros | média ${round(context.weekends.averageCalories)} kcal | meta média ${round(context.weekends.averageGoalCalories)} kcal`
        : "Sem registros alimentares em finais de semana",
      context.weekends.daysWithRecords > 0
    ),
    signal(
      prefix,
      "water",
      "Água",
      context.water.totalConsumedMl > 0
        ? `${round(context.water.totalConsumedMl)} ml consumidos | ${round(context.water.totalGoalMl)} ml de meta | ${context.water.goalHitDays} dias com meta atingida | média ${round(context.water.averageDailyMl)} ml/dia`
        : "Sem registros de água no período",
      context.water.totalConsumedMl > 0
    ),
    signal(
      prefix,
      "exercise",
      "Exercícios",
      context.exercise.activeDays > 0
        ? `${context.exercise.activeDays} dias ativos | ${round(context.exercise.totalDurationMinutes)} min | ${round(context.exercise.totalCalories)} kcal`
        : "Sem exercícios registrados no período",
      context.exercise.activeDays > 0
    ),
    signal(
      prefix,
      "weight",
      "Evolução de peso",
      context.weight.hasData
        ? `${context.weight.firstWeightKg ?? "-"} kg → ${context.weight.lastWeightKg ?? "-"} kg | variação ${context.weight.deltaKg ?? "-"} kg`
        : "Sem dados de peso no período",
      context.weight.hasData
    ),
    signal(
      prefix,
      "food_quality",
      "Qualidade alimentar",
      context.foodQuality.hasData
        ? `${context.foodQuality.daysWithRecords} dias avaliados | índice ${context.foodQuality.qualityIndex ?? "-"} | ultraprocessados ${round(context.foodQuality.ultraProcessedCaloriesPercent)}% | naturais/minimamente processados ${round(context.foodQuality.naturalOrMinimallyProcessedCaloriesPercent)}%`
        : "Sem dados suficientes para calcular qualidade alimentar",
      context.foodQuality.hasData
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
  const sourcesByKey = new Map(
    sourceSignals.map(source => [source.key, source])
  );
  const referencedKeys = [
    ...output.summarySourceKeys,
    ...output.factSourceKeys.flat(),
    ...output.interpretationSourceKeys.flat(),
  ];

  for (const key of referencedKeys) {
    const source = sourcesByKey.get(key);
    if (!source) {
      throw new Error("professional_ai_unknown_source_reference");
    }
    if (!source.available) {
      throw new Error("professional_ai_unavailable_source_reference");
    }
  }
}
