import type { getProfessionalPatientPeriodBundle } from "./service";
import type { listProfessionalOperationalAlerts } from "./operationalAlertsService";
import type {
  ProfessionalAiAssistantOutput,
  ProfessionalAiDraftType,
  ProfessionalAiGenerateInput,
} from "./aiSchemas";

export const PROFESSIONAL_AI_NOTICE =
  "Conteúdo assistido para apoiar a revisão do nutricionista. Não representa diagnóstico, prescrição ou decisão clínica autônoma.";

const ALERT_LABELS: Record<string, string> = {
  no_food_records: "Sem registros alimentares",
  weigh_in_overdue: "Pesagem pendente",
  goal_review_due: "Revisão de meta pendente",
  professional_request_overdue: "Solicitação sem resposta",
  record_requires_review: "Registro que exige revisão",
};

const DRAFT_LABELS: Record<ProfessionalAiDraftType, string> = {
  guidance: "orientação",
  reminder: "lembrete",
  weigh_in_request: "pedido de pesagem",
  record_request: "pedido de registro",
  administrative: "mensagem administrativa",
  follow_up_summary: "resumo de acompanhamento",
};

export type CanonicalPeriodBundle = Awaited<
  ReturnType<typeof getProfessionalPatientPeriodBundle>
>;
export type OperationalAlert = Awaited<
  ReturnType<typeof listProfessionalOperationalAlerts>
>[number];

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function previousProfessionalAiRange(range: {
  startDate: string;
  endDate: string;
}) {
  const start = new Date(`${range.startDate}T12:00:00.000Z`);
  const end = new Date(`${range.endDate}T12:00:00.000Z`);
  const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start.getTime() - 86_400_000);
  const previousStart = new Date(
    previousEnd.getTime() - (dayCount - 1) * 86_400_000
  );
  return { startDate: dateKey(previousStart), endDate: dateKey(previousEnd) };
}

export function professionalAlertLabel(type: string) {
  return ALERT_LABELS[type] ?? "Pendência operacional";
}

function safeAlertSignal(alert: OperationalAlert) {
  return {
    type: alert.type,
    label: professionalAlertLabel(alert.type),
    severity: alert.severity,
    periodStart: alert.period.start,
    periodEnd: alert.period.end,
  };
}

function aggregateDayGroup(
  days: CanonicalPeriodBundle["daily"],
  weekend: boolean
) {
  const selected = days.filter(day => {
    const weekDay = new Date(`${day.date}T12:00:00.000Z`).getUTCDay();
    return weekend ? weekDay === 0 || weekDay === 6 : weekDay > 0 && weekDay < 6;
  });
  const recorded = selected.filter(day => numberValue(day.calories) > 0);
  const calories = selected.reduce(
    (total, day) => total + numberValue(day.calories),
    0
  );
  const goals = selected.reduce(
    (total, day) => total + numberValue(day.adjustedGoalCalories),
    0
  );
  return {
    totalDays: selected.length,
    daysWithRecords: recorded.length,
    averageCalories: round(calories / Math.max(selected.length, 1)),
    averageGoalCalories: round(goals / Math.max(selected.length, 1)),
  };
}

export function buildProfessionalAiContext(
  bundle: CanonicalPeriodBundle,
  alerts: OperationalAlert[]
) {
  const adherence = bundle.analytics.adherence;
  const quality = bundle.quality?.foodQuality;
  return {
    period: bundle.range,
    totals: {
      calories: numberValue(bundle.totals.calories),
      proteinGrams: numberValue(bundle.totals.protein),
      carbsGrams: numberValue(bundle.totals.carbs),
      fatGrams: numberValue(bundle.totals.fat),
    },
    plannedMacros: {
      proteinGrams: numberValue(bundle.analytics.plannedMacros.protein),
      carbsGrams: numberValue(bundle.analytics.plannedMacros.carbs),
      fatGrams: numberValue(bundle.analytics.plannedMacros.fat),
    },
    adherence: {
      percent: numberValue(adherence.adherencePercent),
      daysWithinRange: numberValue(adherence.daysWithinRange),
      daysAboveRange: numberValue(adherence.daysAboveRange),
      daysBelowRange: numberValue(adherence.daysBelowRange),
      daysWithoutRecords: numberValue(adherence.daysWithoutRecords),
    },
    recordFrequency: {
      daysWithRecords: numberValue(
        bundle.analytics.recordFrequency.daysWithRecords
      ),
      daysWithoutRecords: numberValue(
        bundle.analytics.recordFrequency.daysWithoutRecords
      ),
      totalDays: numberValue(bundle.analytics.recordFrequency.totalDays),
    },
    weekdays: aggregateDayGroup(bundle.daily, false),
    weekends: aggregateDayGroup(bundle.daily, true),
    weight: {
      hasData: Boolean(bundle.weightTrend.summary.hasData),
      firstWeightKg: bundle.weightTrend.summary.firstWeightKg,
      lastWeightKg: bundle.weightTrend.summary.lastWeightKg,
      deltaKg: bundle.weightTrend.summary.deltaKg,
    },
    water: {
      totalConsumedMl: numberValue(bundle.habitAnalytics.water.totalConsumedMl),
      totalGoalMl: numberValue(bundle.habitAnalytics.water.totalGoalMl),
      goalHitDays: numberValue(bundle.habitAnalytics.water.goalHitDays),
      averageDailyMl: numberValue(bundle.habitAnalytics.water.averageDailyMl),
    },
    exercise: {
      totalCalories: numberValue(bundle.habitAnalytics.exercise.totalCalories),
      totalDurationMinutes: numberValue(
        bundle.habitAnalytics.exercise.totalDurationMinutes
      ),
      activeDays: numberValue(bundle.habitAnalytics.exercise.activeDays),
    },
    foodQuality: {
      hasData: Boolean(quality?.hasData),
      daysWithRecords: numberValue(quality?.daysWithRecords),
      qualityIndex: quality?.qualityIndex ?? null,
      ultraProcessedCaloriesPercent: numberValue(
        quality?.ultraProcessedCaloriesPercent
      ),
      naturalOrMinimallyProcessedCaloriesPercent: numberValue(
        quality?.naturalOrMinimallyProcessedCaloriesPercent
      ),
    },
    alerts: alerts.map(safeAlertSignal),
  };
}

export type ProfessionalAiContext = ReturnType<typeof buildProfessionalAiContext>;

function missingData(
  context: ProfessionalAiContext,
  periodLabel: "período selecionado" | "período anterior"
) {
  const missing: string[] = [];
  if (!context.recordFrequency.daysWithRecords) {
    missing.push(`Não há registros alimentares no ${periodLabel}.`);
  }
  if (!context.weight.hasData) {
    missing.push(`Não há peso disponível para o ${periodLabel}.`);
  }
  if (!context.water.totalConsumedMl) {
    missing.push(`Não há registros de água no ${periodLabel}.`);
  }
  if (!context.exercise.activeDays) {
    missing.push(`Não há exercícios registrados no ${periodLabel}.`);
  }
  if (!context.foodQuality.hasData) {
    missing.push(
      `Não há dados suficientes para indicadores de qualidade alimentar no ${periodLabel}.`
    );
  }
  return missing;
}

export function buildCanonicalMissingData(
  context: ProfessionalAiContext,
  previous?: ProfessionalAiContext
) {
  return [
    ...missingData(context, "período selecionado"),
    ...(previous ? missingData(previous, "período anterior") : []),
  ];
}

export function buildCanonicalFacts(context: ProfessionalAiContext) {
  const facts = [
    `${context.recordFrequency.daysWithRecords} de ${context.recordFrequency.totalDays} dias possuem registros alimentares.`,
  ];
  const factSourceKeys: string[][] = [["current_record_frequency"]];

  if (context.recordFrequency.daysWithRecords > 0) {
    facts.push(
      `A aderência calórica calculada pelo relatório canônico foi de ${round(context.adherence.percent)}%.`
    );
    factSourceKeys.push(["current_adherence"]);
  }
  if (context.water.totalConsumedMl > 0) {
    facts.push(
      `Foram registrados ${round(context.water.totalConsumedMl)} ml de água.`
    );
    factSourceKeys.push(["current_water"]);
  }
  if (context.exercise.activeDays > 0) {
    facts.push(
      `Foram registrados exercícios em ${context.exercise.activeDays} dia(s).`
    );
    factSourceKeys.push(["current_exercise"]);
  }
  if (context.weight.hasData) {
    facts.push(
      `O peso variou de ${context.weight.firstWeightKg ?? "-"} kg para ${context.weight.lastWeightKg ?? "-"} kg no período.`
    );
    factSourceKeys.push(["current_weight"]);
  }
  return { facts, factSourceKeys };
}

function deterministicDraft(
  type: ProfessionalAiDraftType,
  context: ProfessionalAiContext
) {
  const period = `${context.period.startDate} a ${context.period.endDate}`;
  const frequency = `${context.recordFrequency.daysWithRecords} de ${context.recordFrequency.totalDays} dias com registros`;
  switch (type) {
    case "weigh_in_request":
      return "Olá! Para mantermos o acompanhamento atualizado, poderia registrar uma nova pesagem? Assim consigo revisar a evolução junto com você.";
    case "record_request":
      return `Olá! No período de ${period}, identifiquei ${frequency}. Quando possível, registre suas refeições para termos uma visão mais completa no próximo acompanhamento.`;
    case "reminder":
      return `Olá! Passando para lembrar do acompanhamento. Revisei o período de ${period} e podemos conversar sobre os registros e pendências na próxima revisão.`;
    case "administrative":
      return "Olá! Esta é uma mensagem administrativa sobre seu acompanhamento. Quando puder, confirme o recebimento para alinharmos o próximo passo.";
    case "follow_up_summary":
      return context.recordFrequency.daysWithRecords > 0
        ? `Resumo para revisão: período de ${period}, ${frequency}, aderência calórica de ${round(context.adherence.percent)}% e ${context.alerts.length} alerta(s) objetivo(s) aberto(s). Revisar os dados com o paciente antes de qualquer orientação.`
        : `Resumo para revisão: período de ${period}, sem registros alimentares e com ${context.alerts.length} alerta(s) objetivo(s) aberto(s). Não inferir aderência sem dados; revisar com o paciente antes de qualquer orientação.`;
    case "guidance":
      return `Olá! Revisei seus registros de ${period}. Temos ${frequency}. Gostaria de conversar sobre como foi sua rotina nesse período antes de definirmos juntos os próximos ajustes.`;
  }
}

export function buildProfessionalAiFallbackOutput(
  input: ProfessionalAiGenerateInput,
  context: ProfessionalAiContext,
  previous?: ProfessionalAiContext,
  clinicalBoundary = false
): ProfessionalAiAssistantOutput {
  const period = `${context.period.startDate} a ${context.period.endDate}`;
  const { facts, factSourceKeys } = buildCanonicalFacts(context);
  const interpretations: string[] = [];
  const interpretationSourceKeys: string[][] = [];

  if (
    input.mode === "comparison" &&
    previous &&
    context.recordFrequency.daysWithRecords > 0 &&
    previous.recordFrequency.daysWithRecords > 0
  ) {
    const difference = round(
      context.adherence.percent - previous.adherence.percent
    );
    interpretations.push(
      `A aderência variou ${difference >= 0 ? "+" : ""}${difference} ponto(s) percentual(is) em relação ao período anterior.`
    );
    interpretationSourceKeys.push([
      "current_adherence",
      "previous_adherence",
    ]);
  } else if (
    input.mode !== "comparison" &&
    context.weekdays.daysWithRecords > 0 &&
    context.weekends.daysWithRecords > 0
  ) {
    interpretations.push(
      `A média registrada foi de ${context.weekdays.averageCalories} kcal nos dias úteis e ${context.weekends.averageCalories} kcal nos finais de semana.`
    );
    interpretationSourceKeys.push([
      "current_weekdays",
      "current_weekends",
    ]);
  }

  if (context.alerts.length) {
    interpretations.push(
      `Existem ${context.alerts.length} alerta(s) objetivo(s) para revisão humana.`
    );
    interpretationSourceKeys.push(["current_alerts"]);
  }
  if (!interpretations.length) {
    interpretations.push(
      "Os dados disponíveis são insuficientes para uma comparação adicional sem fazer suposições."
    );
    interpretationSourceKeys.push(
      input.mode === "comparison" && previous
        ? ["current_record_frequency", "previous_record_frequency"]
        : ["current_record_frequency"]
    );
  }

  const draftType = input.draftType ?? "follow_up_summary";
  return {
    title: clinicalBoundary
      ? "Limite da assistência"
      : input.mode === "comparison"
        ? "Comparação de períodos"
        : input.mode === "draft"
          ? `Rascunho de ${DRAFT_LABELS[draftType]}`
          : input.mode === "question"
            ? "Resposta assistida"
            : "Resumo do período",
    summary: clinicalBoundary
      ? "A solicitação exige diagnóstico, prescrição ou decisão clínica. A IA não pode realizar essa ação; use os dados objetivos abaixo como apoio para sua avaliação profissional."
      : `Leitura objetiva dos dados autorizados entre ${period}.`,
    summarySourceKeys: ["current_period"],
    facts,
    factSourceKeys,
    interpretations,
    interpretationSourceKeys,
    missingData: buildCanonicalMissingData(context, previous),
    cautions: clinicalBoundary
      ? ["A decisão clínica deve ser realizada e revisada pelo profissional responsável."]
      : [],
    draft:
      input.mode === "draft"
        ? {
            messageType: draftType,
            content: deterministicDraft(draftType, context),
          }
        : null,
    educationalNotice: PROFESSIONAL_AI_NOTICE,
  };
}
