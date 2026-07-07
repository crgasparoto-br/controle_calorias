import type { MealProcessingResult } from "../../nutritionEngine";
import { getWhatsAppExerciseCaloriesForDateKey } from "./goalProgressContext";
import {
  buildWhatsAppBlock,
  buildWhatsAppFoodLines,
  buildWhatsAppGoalProgressLines,
  buildWhatsAppMealTotalLines,
  buildWhatsAppSeparator,
  buildWhatsAppTitle,
  type WhatsAppFoodReplyItem,
  type WhatsAppNutritionTotals,
} from "./replyTemplates";

export type WhatsAppMealGoalProgress = {
  consumedCalories: number;
  goalCalories: number;
  exerciseCalories?: number;
};

export type WhatsAppMealReplyOptions = {
  registeredAt?: Date;
  goalProgress?: WhatsAppMealGoalProgress | null;
};

export type WhatsAppConsolidatedMealReplyInput = {
  mealLabel?: string | null;
  occurredAt?: number | string | Date | null;
  items: WhatsAppFoodReplyItem[];
};

export type WhatsAppMealActionReplyOptions = WhatsAppMealReplyOptions & {
  title: string;
  actionLines?: string[];
};

export type WhatsAppAuxiliaryReplyOptions = {
  title: string;
  lines?: Array<string | null | undefined>;
};

export type WhatsAppAudioTranscriptionFailureCode = "INVALID_FORMAT" | "FILE_TOO_LARGE" | "EMPTY_TRANSCRIPT" | "TRANSCRIPTION_FAILED" | string;

function formatDateKeyInSaoPaulo(date?: Date) {
  if (!date) {
    return undefined;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatTimeInSaoPaulo(date?: Date) {
  if (!date) {
    return undefined;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeReplyDate(date?: Date | number | string | null) {
  if (!date) {
    return undefined;
  }
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildMealTitle(mealLabel?: string | null, registeredAt?: Date, consolidated = false) {
  const label = mealLabel?.trim();
  const time = formatTimeInSaoPaulo(registeredAt);
  const suffix = time ? ` às ${time}hs.` : ".";

  if (!label || label.toLowerCase() === "refeição") {
    return buildWhatsAppTitle(`${consolidated ? "Refeição atualizada" : "Refeição registrada"}${suffix}`, { bold: true });
  }

  return buildWhatsAppTitle(`${label} ${consolidated ? "Atualizado" : "Registrado"}${suffix}`, { bold: true });
}

function buildMealGoalProgressLines(progress: WhatsAppMealGoalProgress | null | undefined, registeredAt?: Date) {
  const contextualExerciseCalories = getWhatsAppExerciseCaloriesForDateKey(formatDateKeyInSaoPaulo(registeredAt));
  return buildWhatsAppGoalProgressLines(progress
    ? { ...progress, exerciseCalories: progress.exerciseCalories ?? contextualExerciseCalories ?? 0 }
    : null);
}

function sumReplyItems(items: WhatsAppFoodReplyItem[]): WhatsAppNutritionTotals {
  return items.reduce(
    (totals, item) => ({
      calories: totals.calories + Number(item.calories || 0),
      protein: totals.protein + Number(item.protein || 0),
      carbs: totals.carbs + Number(item.carbs || 0),
      fat: totals.fat + Number(item.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function buildMealItemLines(items: WhatsAppFoodReplyItem[]) {
  return items.flatMap((item, index) => [
    ...buildWhatsAppFoodLines(item),
    ...(index < items.length - 1 ? [buildWhatsAppSeparator()] : []),
  ]);
}

function buildMealReplyBody(input: {
  title: string;
  sourceText?: string | null;
  items: WhatsAppFoodReplyItem[];
  totals: WhatsAppNutritionTotals;
  goalLines: string[];
}) {
  if (!input.items.length) {
    return buildWhatsAppBlock([
      input.title,
      buildWhatsAppSeparator(),
      input.sourceText || "Não consegui identificar os alimentos com segurança.",
      buildWhatsAppSeparator(),
      ...buildWhatsAppMealTotalLines(input.totals),
      ...(input.goalLines.length ? [buildWhatsAppSeparator(), ...input.goalLines] : []),
    ]);
  }

  return buildWhatsAppBlock([
    input.title,
    buildWhatsAppSeparator(),
    "Itens:",
    ...buildMealItemLines(input.items),
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(input.totals),
    ...(input.goalLines.length ? [buildWhatsAppSeparator(), ...input.goalLines] : []),
  ]);
}

export function buildWhatsAppAuxiliaryReplyMessage(options: WhatsAppAuxiliaryReplyOptions) {
  return buildWhatsAppBlock([
    buildWhatsAppTitle(options.title, { bold: true }),
    buildWhatsAppSeparator(),
    ...(options.lines ?? []),
  ]);
}

export function buildWhatsAppClarificationReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Preciso de uma informação",
    lines: [message],
  });
}

export function buildWhatsAppItemNotFoundReplyMessage(params: {
  target?: string | null;
  context?: string;
  instruction: string;
}) {
  const targetLine = params.target?.trim()
    ? `Não encontrei ${params.target} ${params.context ?? "nas refeições recentes"}.`
    : `Não encontrei esse item ${params.context ?? "nas refeições recentes"}.`;
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Item não encontrado",
    lines: [targetLine, params.instruction],
  });
}

export function buildWhatsAppAmbiguousItemReplyMessage(params: {
  target?: string | null;
  context?: string;
  options: string;
  instruction: string;
}) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Preciso confirmar o item",
    lines: [
      `Encontrei mais de um item para ${params.target ?? "esse alimento"} ${params.context ?? "na refeição"}:`,
      params.options,
      params.instruction,
    ],
  });
}

export function buildWhatsAppActionConfirmationRequestReplyMessage(params: {
  summary: string;
  confirmInstruction?: string;
  cancelInstruction?: string;
}) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Confirmação necessária",
    lines: [
      params.summary,
      params.confirmInstruction ?? "Responda SIM para confirmar.",
      params.cancelInstruction ?? "Responda CANCELAR para desistir.",
    ],
  });
}

export function buildWhatsAppActionConfirmedReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Alteração confirmada",
    lines: [message],
  });
}

export function buildWhatsAppActionCancelledReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Alteração cancelada",
    lines: [message],
  });
}

export function buildWhatsAppRecoverableErrorReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Não consegui concluir agora",
    lines: [message],
  });
}

export function buildWhatsAppSecurityBlockedReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Não posso seguir essa instrução",
    lines: [
      "Não posso executar instruções para alterar regras, permissões, validações ou acessar dados de outras pessoas.",
      "Para registrar uma refeição, corrigir um item ou consultar seus próprios registros, envie o pedido normalmente.",
    ],
  });
}

export function buildWhatsAppAudioTranscriptionFailureReplyMessage(code: WhatsAppAudioTranscriptionFailureCode) {
  if (code === "INVALID_FORMAT") {
    return buildWhatsAppRecoverableErrorReplyMessage("Não consegui ouvir seu áudio com segurança porque o formato não pôde ser lido. Pode reenviar o áudio ou escrever a refeição em texto?");
  }

  if (code === "FILE_TOO_LARGE") {
    return buildWhatsAppRecoverableErrorReplyMessage("Não consegui ouvir seu áudio com segurança porque o arquivo está grande demais. Pode enviar um áudio menor ou escrever a refeição em texto?");
  }

  if (code === "EMPTY_TRANSCRIPT") {
    return buildWhatsAppRecoverableErrorReplyMessage("Não consegui ouvir seu áudio com segurança porque não identifiquei uma fala útil. Pode reenviar o áudio ou escrever a refeição em texto?");
  }

  return buildWhatsAppRecoverableErrorReplyMessage("Não consegui ouvir/transcrever seu áudio com segurança porque ocorreu uma falha na transcrição. Pode reenviar o áudio ou escrever a refeição em texto?");
}

export function buildWhatsAppPartialAudioTranscriptionReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Áudio não transcrito",
    lines: ["Vou considerar o texto que você enviou, mas não consegui transcrever o áudio com segurança. Se faltou alguma informação do áudio, pode enviar em texto depois."],
  });
}

export function buildWhatsAppWaterLoggedReplyMessage(params: { amountLabel: string; occurredAtLabel: string }) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Água registrada",
    lines: [`Registrei ${params.amountLabel} ml de água em ${params.occurredAtLabel}.`],
  });
}

export function buildWhatsAppWeightLoggedReplyMessage(params: { weightLabel: string; occurredAtLabel: string }) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Peso atualizado",
    lines: [`Atualizei seu peso atual para ${params.weightLabel} kg em ${params.occurredAtLabel}.`],
  });
}

export function buildWhatsAppSnackSuggestionReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Sugestão para o lanche da tarde",
    lines: [
      "• Iogurte natural com banana e aveia",
      "  Aproximadamente 280 kcal | boa proteína e energia para a tarde",
      buildWhatsAppSeparator(),
      "Outra opção:",
      "• Pão integral com queijo branco e tomate",
      "  Aproximadamente 300 kcal | simples, saciante e fácil de montar",
      buildWhatsAppSeparator(),
      "Se quiser, envie o que você tem em casa que eu sugiro uma opção mais certeira.",
    ],
  });
}

export function buildWhatsAppPeriodReportReplyMessage(params: {
  periodLabel: string;
  mealCount: number;
  mealBreakdownLines: string[];
  goalSummaryLines: string[];
}) {
  if (params.mealCount <= 0) {
    return buildWhatsAppAuxiliaryReplyMessage({
      title: `Resumo de ${params.periodLabel}`,
      lines: ["Não encontrei refeições registradas nesse período."],
    });
  }

  return buildWhatsAppAuxiliaryReplyMessage({
    title: `Resumo de ${params.periodLabel}`,
    lines: [
      `Refeições registradas: ${params.mealCount}`,
      buildWhatsAppSeparator(),
      ...params.mealBreakdownLines,
      ...(params.goalSummaryLines.length ? [buildWhatsAppSeparator(), ...params.goalSummaryLines] : []),
    ],
  });
}

export function buildWhatsAppMealReplyMessage(processed: MealProcessingResult, options: WhatsAppMealReplyOptions = {}) {
  const title = buildMealTitle(processed.detectedMealLabel, options.registeredAt);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, options.registeredAt);

  return buildMealReplyBody({
    title,
    sourceText: processed.sourceText,
    items: processed.items,
    totals: processed.totals,
    goalLines,
  });
}

export function buildWhatsAppConsolidatedMealReplyMessage(meal: WhatsAppConsolidatedMealReplyInput, options: WhatsAppMealReplyOptions = {}) {
  const registeredAt = options.registeredAt ?? normalizeReplyDate(meal.occurredAt);
  const title = buildMealTitle(meal.mealLabel, registeredAt, true);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, registeredAt);

  return buildMealReplyBody({
    title,
    items: meal.items,
    totals: sumReplyItems(meal.items),
    goalLines,
  });
}

export function buildWhatsAppMealActionReplyMessage(meal: WhatsAppConsolidatedMealReplyInput, options: WhatsAppMealActionReplyOptions) {
  const registeredAt = options.registeredAt ?? normalizeReplyDate(meal.occurredAt);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, registeredAt);
  const actionLines = options.actionLines?.filter(Boolean) ?? [];

  return buildWhatsAppBlock([
    buildWhatsAppTitle(options.title, { bold: true }),
    ...(actionLines.length ? [buildWhatsAppSeparator(), ...actionLines] : []),
    buildWhatsAppSeparator(),
    "Refeição atualizada:",
    ...buildMealItemLines(meal.items),
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(sumReplyItems(meal.items)),
    ...(goalLines.length ? [buildWhatsAppSeparator(), ...goalLines] : []),
  ]);
}
