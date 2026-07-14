import type { MealProcessingResult } from "../../nutritionEngine";
import {
  buildWhatsAppBlock,
  buildWhatsAppFoodLines,
  buildWhatsAppGoalProgressLines,
  buildWhatsAppMealTotalLines,
  buildWhatsAppSeparator,
  buildWhatsAppTitle,
  formatWhatsAppNumber,
  type WhatsAppFoodReplyItem,
  type WhatsAppGoalProgressInput,
  type WhatsAppNutritionTotals,
} from "./replyTemplates";

export type WhatsAppMealGoalProgress = WhatsAppGoalProgressInput & {
  /** Campo mantido durante a migração; deve conter a meta efetiva final. */
  goalCalories: number;
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
  mealResultState?: "registered" | "updated";
};

export type WhatsAppAuxiliaryReplyOptions = {
  title: string;
  lines?: Array<string | null | undefined>;
};

export type WhatsAppAudioTranscriptionFailureCode = "INVALID_FORMAT" | "FILE_TOO_LARGE" | "EMPTY_TRANSCRIPT" | "TRANSCRIPTION_FAILED" | string;

function formatTimeInSaoPaulo(date?: Date) {
  if (!date) return undefined;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeReplyDate(date?: Date | number | string | null) {
  if (!date) return undefined;
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildMealResultTitle(state: "registered" | "updated") {
  return state === "registered"
    ? "✅ *Refeição registrada:*"
    : "✅ *Refeição atualizada:*";
}

/** Bloco canônico de contexto reutilizado por registro, atualização, consulta e ações (issue #783). */
export function buildWhatsAppMealContextLine(mealLabel?: string | null, occurredAt?: Date | number | string | null) {
  const label = mealLabel?.trim() || "Refeição";
  const time = formatTimeInSaoPaulo(normalizeReplyDate(occurredAt));
  return `🍽️ ${buildWhatsAppTitle(label, { bold: true })}${time ? ` — ${time}` : ""}`;
}

function buildMealGoalProgressLines(progress: WhatsAppMealGoalProgress | null | undefined) {
  return buildWhatsAppGoalProgressLines(progress ?? null);
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
  state: "registered" | "updated";
  contextLine: string;
  sourceText?: string | null;
  items: WhatsAppFoodReplyItem[];
  totals: WhatsAppNutritionTotals;
  goalLines: string[];
}) {
  const itemLines = input.items.length
    ? buildMealItemLines(input.items)
    : [input.sourceText || "Não consegui identificar os alimentos com segurança."];

  return buildWhatsAppBlock([
    buildMealResultTitle(input.state),
    buildWhatsAppSeparator(),
    input.contextLine,
    buildWhatsAppSeparator(),
    ...itemLines,
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(input.totals),
    ...(input.goalLines.length ? [buildWhatsAppSeparator(), ...input.goalLines] : []),
  ]);
}

function normalizeActionLine(line: string) {
  return line === "Recalculei os macros." ? "recalculei os macros." : line;
}

function auxiliaryTimePreposition(label: string) {
  return /\d{1,2}\/\d{1,2}\/\d{4}/.test(label) ? "em" : "às";
}

export function buildWhatsAppAuxiliaryReplyMessage(options: WhatsAppAuxiliaryReplyOptions) {
  return buildWhatsAppBlock([
    buildWhatsAppTitle(options.title, { bold: true }),
    buildWhatsAppSeparator(),
    ...(options.lines ?? []),
  ]);
}

export function buildWhatsAppClarificationReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({ title: "⚠️ Preciso de uma informação", lines: [message] });
}

export function buildWhatsAppItemNotFoundReplyMessage(params: { target?: string | null; context?: string; instruction: string }) {
  const context = params.context?.trim();
  const targetLine = params.target?.trim()
    ? `Não encontrei ${params.target}${context ? ` ${context}` : ""}.`
    : `Não encontrei esse item${context ? ` ${context}` : " nas refeições recentes"}.`;
  return buildWhatsAppAuxiliaryReplyMessage({ title: "⚠️ Item não encontrado", lines: [targetLine, params.instruction] });
}

export function buildWhatsAppAmbiguousItemReplyMessage(params: { target?: string | null; context?: string; options: string; instruction: string }) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Preciso confirmar o item",
    lines: [
      `Encontrei mais de um item para ${params.target ?? "esse alimento"} ${params.context ?? "na refeição"}:`,
      params.options,
      params.instruction,
    ],
  });
}

export function buildWhatsAppActionConfirmationRequestReplyMessage(params: { summary: string; confirmInstruction?: string; cancelInstruction?: string }) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Confirmação necessária",
    lines: [
      params.summary,
      params.confirmInstruction ?? "Use Confirmar para continuar.",
      params.cancelInstruction ?? "Use Cancelar para desistir.",
    ],
  });
}

export function buildWhatsAppActionConfirmedReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({ title: "✅ Alteração confirmada", lines: [message] });
}

export function buildWhatsAppActionCancelledReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({ title: "✅ Alteração cancelada", lines: [message] });
}

export function buildWhatsAppRecoverableErrorReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({ title: "⚠️ Serviço temporariamente indisponível", lines: [message] });
}

/** Pendência expirada, consumida, cancelada ou de callback inválido (issue #782). */
export function buildWhatsAppCallbackUnavailableReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Esta solicitação não está mais disponível",
    lines: ["Ela já foi concluída, cancelada ou expirou. Envie novamente o que deseja fazer."],
  });
}

/** Pendência válida, mas o recurso atual não existe mais ou não satisfaz a condição registrada. */
export function buildWhatsAppCallbackResourceNotFoundReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Registro não encontrado",
    lines: ["O registro pode ter sido alterado ou excluído. Consulte os dados atuais e tente novamente."],
  });
}

export function buildWhatsAppSecurityBlockedReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não foi possível atender à solicitação",
    lines: ["Envie uma pergunta ou ação relacionada ao seu acompanhamento nutricional."],
  });
}

export function buildWhatsAppAudioTranscriptionFailureReplyMessage(code: WhatsAppAudioTranscriptionFailureCode) {
  if (code === "EMPTY_TRANSCRIPT") {
    return buildWhatsAppAuxiliaryReplyMessage({
      title: "⚠️ Não consegui entender o áudio",
      lines: ["Envie o áudio novamente, falando mais próximo do microfone, ou descreva a informação por texto."],
    });
  }
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não foi possível processar o áudio",
    lines: ["Tente enviar novamente. Se o problema continuar, envie a informação por texto."],
  });
}

export function buildWhatsAppPartialAudioTranscriptionReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Áudio não transcrito",
    lines: ["Vou considerar somente o texto enviado. Caso alguma informação estivesse no áudio, envie-a novamente por texto."],
  });
}

export function buildWhatsAppImageNotRecognizedReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não consegui identificar a refeição",
    lines: ["Envie uma foto mais nítida ou descreva os alimentos e as quantidades por mensagem."],
  });
}

export function buildWhatsAppImageProcessingFailureReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não foi possível processar a imagem",
    lines: ["Tente enviar a foto novamente. Se o problema continuar, descreva a refeição por mensagem."],
  });
}

export function buildWhatsAppWaterLoggedReplyMessage(params: {
  amountLabel: string;
  occurredAtLabel: string;
  totalMl?: number | null;
  goalMl?: number | null;
}) {
  const difference = typeof params.totalMl === "number" && typeof params.goalMl === "number"
    ? params.totalMl - params.goalMl
    : null;
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "💧 Água registrada",
    lines: [
      `*Quantidade:* ${params.amountLabel} ml`,
      ...(typeof params.totalMl === "number" ? [`*Total:* ${formatWhatsAppNumber(params.totalMl)} ml`] : []),
      ...(typeof params.goalMl === "number"
        ? [`*Meta:* ${formatWhatsAppNumber(params.goalMl)} ml${difference === null ? "" : ` (${difference > 0 ? "+" : ""}${formatWhatsAppNumber(difference)} ml)`}`]
        : []),
      `*Data:* ${params.occurredAtLabel}`,
    ],
  });
}

export function buildWhatsAppWaterVolumeNeededReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Preciso do volume da água",
    lines: ["Identifiquei água na imagem, mas não consegui identificar o volume. Informe quantos ml ou litros foram consumidos."],
  });
}

export function buildWhatsAppWeightLoggedReplyMessage(params: {
  weightLabel: string;
  occurredAtLabel: string;
  variationLabel?: string | null;
}) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚖️ Peso registrado",
    lines: [
      `*Peso:* ${params.weightLabel} kg`,
      `*Variação:* ${params.variationLabel ?? "primeiro registro"}`,
      `*Data:* ${params.occurredAtLabel}`,
    ],
  });
}

export function buildWhatsAppExerciseLoggedReplyMessage(params: {
  activity: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  calories?: number | null;
  occurredAtLabel: string;
  caloriesEstimated?: boolean;
}) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "🏃 Exercício registrado",
    lines: [
      `*Atividade:* ${params.activity}`,
      ...(typeof params.durationMinutes === "number" ? [`*Duração:* ${formatWhatsAppNumber(params.durationMinutes)} min`] : []),
      ...(typeof params.distanceKm === "number" ? [`*Distância:* ${formatWhatsAppNumber(params.distanceKm)} km`] : []),
      ...(typeof params.calories === "number" ? [`*Calorias:* ${formatWhatsAppNumber(params.calories)} kcal`] : []),
      `*Data:* ${params.occurredAtLabel}`,
      ...(params.caloriesEstimated ? [buildWhatsAppSeparator(), "⚠️ Calorias estimadas pelo sistema."] : []),
    ],
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
      "Os valores variam conforme o alimento e o preparo. A sugestão não registra alimentos automaticamente.",
    ],
  });
}

export function buildWhatsAppPeriodReportReplyMessage(params: { periodLabel: string; mealCount: number; mealBreakdownLines: string[]; goalSummaryLines: string[] }) {
  if (params.mealCount <= 0) {
    return buildWhatsAppAuxiliaryReplyMessage({ title: `Resumo de ${params.periodLabel}`, lines: ["Não encontrei refeições registradas nesse período."] });
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
  const registeredAt = options.registeredAt;
  return buildMealReplyBody({
    state: "registered",
    contextLine: buildWhatsAppMealContextLine(processed.detectedMealLabel, registeredAt),
    sourceText: processed.sourceText,
    items: processed.items,
    totals: processed.totals,
    goalLines: buildMealGoalProgressLines(options.goalProgress),
  });
}

export function buildWhatsAppConsolidatedMealReplyMessage(meal: WhatsAppConsolidatedMealReplyInput, options: WhatsAppMealReplyOptions = {}) {
  const registeredAt = options.registeredAt ?? normalizeReplyDate(meal.occurredAt);
  return buildMealReplyBody({
    state: "updated",
    contextLine: buildWhatsAppMealContextLine(meal.mealLabel, registeredAt),
    items: meal.items,
    totals: sumReplyItems(meal.items),
    goalLines: buildMealGoalProgressLines(options.goalProgress),
  });
}

export function buildWhatsAppMealActionReplyMessage(meal: WhatsAppConsolidatedMealReplyInput, options: WhatsAppMealActionReplyOptions) {
  const registeredAt = options.registeredAt ?? normalizeReplyDate(meal.occurredAt);
  const goalLines = buildMealGoalProgressLines(options.goalProgress);
  const actionLines = options.actionLines?.filter(Boolean).map(normalizeActionLine) ?? [];
  const state = options.mealResultState === "registered" ? "registered" : "updated";

  return buildWhatsAppBlock([
    buildWhatsAppTitle(options.title, { bold: true }),
    ...(actionLines.length ? [buildWhatsAppSeparator(), ...actionLines] : []),
    buildWhatsAppSeparator(),
    buildMealResultTitle(state),
    buildWhatsAppMealContextLine(meal.mealLabel, registeredAt),
    ...buildMealItemLines(meal.items),
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(sumReplyItems(meal.items)),
    ...(goalLines.length ? [buildWhatsAppSeparator(), ...goalLines] : []),
  ]);
}
