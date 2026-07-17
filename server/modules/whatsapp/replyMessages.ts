import type { MealProcessingResult } from "../../nutritionEngine";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
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
  includeExerciseCalories?: boolean;
};

export type WhatsAppMealReplyOptions = {
  registeredAt?: Date;
  goalProgress?: WhatsAppMealGoalProgress | null;
  timeZone?: string;
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

function formatReplyDateKey(date: Date | undefined, timeZone: string) {
  return date ? getDateKeyInTimeZone(date, timeZone) : undefined;
}

function formatReplyTime(date: Date | undefined, timeZone: string) {
  if (!date) return undefined;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
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

function buildMealTitle(mealLabel: string | null | undefined, registeredAt: Date | undefined, consolidated = false, timeZone = DEFAULT_APP_TIME_ZONE) {
  const label = mealLabel?.trim();
  const time = formatReplyTime(registeredAt, timeZone);
  const suffix = time ? ` às ${time}hs.` : ".";
  if (!label || label.toLowerCase() === "refeição") {
    return buildWhatsAppTitle(`${consolidated ? "Refeição atualizada" : "Refeição registrada"}${suffix}`, { bold: true });
  }
  return buildWhatsAppTitle(`${label} ${consolidated ? "Atualizado" : "Registrado"}${suffix}`, { bold: true });
}

/** Bloco canônico de contexto reutilizado por registro, atualização, consulta e ações (issue #783). */
export function buildWhatsAppMealContextLine(mealLabel?: string | null, occurredAt?: Date | number | string | null, timeZone = DEFAULT_APP_TIME_ZONE) {
  const label = mealLabel?.trim() || "Refeição";
  const time = formatReplyTime(normalizeReplyDate(occurredAt), timeZone);
  return `🍽️ ${buildWhatsAppTitle(label, { bold: true })}${time ? ` — ${time}` : ""}`;
}

function buildMealGoalProgressLines(progress: WhatsAppMealGoalProgress | null | undefined, registeredAt: Date | undefined, timeZone: string) {
  const contextualExerciseCalories = getWhatsAppExerciseCaloriesForDateKey(formatReplyDateKey(registeredAt, timeZone));
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
  contextLine: string;
  sourceText?: string | null;
  items: WhatsAppFoodReplyItem[];
  totals: WhatsAppNutritionTotals;
  goalLines: string[];
}) {
  if (!input.items.length) {
    return buildWhatsAppBlock([
      input.contextLine,
      buildWhatsAppSeparator(),
      input.title,
      buildWhatsAppSeparator(),
      input.sourceText || "Não consegui identificar os alimentos com segurança.",
      buildWhatsAppSeparator(),
      ...buildWhatsAppMealTotalLines(input.totals),
      ...(input.goalLines.length ? [buildWhatsAppSeparator(), ...input.goalLines] : []),
    ]);
  }

  return buildWhatsAppBlock([
    input.contextLine,
    buildWhatsAppSeparator(),
    input.title,
    buildWhatsAppSeparator(),
    "Itens:",
    ...buildMealItemLines(input.items),
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
  return buildWhatsAppAuxiliaryReplyMessage({ title: "Preciso de uma informação", lines: [message] });
}

export function buildWhatsAppItemNotFoundReplyMessage(params: { target?: string | null; context?: string; instruction: string }) {
  const context = params.context?.trim();
  const targetLine = params.target?.trim()
    ? `Não encontrei ${params.target}${context ? ` ${context}` : ""}.`
    : `Não encontrei esse item${context ? ` ${context}` : " nas refeições recentes"}.`;
  return buildWhatsAppAuxiliaryReplyMessage({ title: "Item não encontrado", lines: [targetLine, params.instruction] });
}

export function buildWhatsAppAmbiguousItemReplyMessage(params: { target?: string | null; context?: string; options: string; instruction: string }) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Preciso confirmar o item",
    lines: [
      `Encontrei mais de um item para ${params.target ?? "esse alimento"} ${params.context ?? "na refeição"}:`,
      params.options,
      params.instruction,
    ],
  });
}

export function buildWhatsAppActionConfirmationRequestReplyMessage(params: { summary: string; confirmInstruction?: string; cancelInstruction?: string }) {
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
  return buildWhatsAppAuxiliaryReplyMessage({ title: "Alteração confirmada", lines: [message] });
}

export function buildWhatsAppActionCancelledReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({ title: "Alteração cancelada", lines: [message] });
}

export function buildWhatsAppRecoverableErrorReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({ title: "Não consegui concluir agora", lines: [message] });
}

/** Pendência expirada, consumida, cancelada ou de callback inválido (issue #782): nunca revela o estado exato. */
export function buildWhatsAppCallbackUnavailableReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Esta solicitação não está mais disponível",
    lines: ["Ela já foi concluída, cancelada ou expirou. Envie novamente o que deseja fazer."],
  });
}

/** Pendência válida, mas o recurso atual não existe mais ou não satisfaz mais a condição registrada (issue #782). */
export function buildWhatsAppCallbackResourceNotFoundReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Registro não encontrado",
    lines: ["O registro pode ter sido alterado ou excluído. Consulte os dados atuais e tente novamente."],
  });
}

export function buildWhatsAppUnlinkedAccountReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "🔒 Conta não identificada",
    lines: [
      "Não consegui associar este número do WhatsApp a uma conta ativa.",
      "Verifique o telefone cadastrado no sistema web.",
    ],
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

export function buildWhatsAppPartialAudioTranscriptionReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Áudio não transcrito",
    lines: ["Vou considerar o texto que você enviou, mas não consegui transcrever o áudio com segurança. Se faltou alguma informação do áudio, pode enviar em texto depois."],
  });
}

export function buildWhatsAppWaterLoggedReplyMessage(params: { amountLabel: string; occurredAtLabel: string }) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Água registrada",
    lines: [`Registrei ${params.amountLabel} ml de água ${auxiliaryTimePreposition(params.occurredAtLabel)} ${params.occurredAtLabel}.`],
  });
}

export function buildWhatsAppWaterVolumeNeededReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Preciso do volume da água",
    lines: ["Identifiquei água na imagem, mas não consegui identificar o volume consumido. Pode me dizer quantos ml ou litros foram, por favor?"],
  });
}

export function buildWhatsAppWaterImageClarificationReplyMessage() {
  return buildWhatsAppClarificationReplyMessage(
    "Identifiquei água na imagem. Para registrar corretamente, informe a quantidade aproximada, por exemplo: 300 ml de água.",
  );
}

export function buildWhatsAppOnboardingLeadReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Boas-vindas ao Controle de Calorias",
    lines: [
      "Para começar pelo WhatsApp, finalize seu cadastro no site pelo link seguro abaixo.",
      "Depois disso, este canal poderá registrar suas refeições automaticamente.",
      "Para perguntas livres à IA, inicie a mensagem com `/`.",
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
      "Se quiser, envie o que você tem em casa que eu sugiro uma opção mais certeira.",
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
  const timeZone = options.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const title = buildMealTitle(processed.detectedMealLabel, registeredAt, false, timeZone);
  const contextLine = buildWhatsAppMealContextLine(processed.detectedMealLabel, registeredAt, timeZone);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, registeredAt, timeZone);
  return buildMealReplyBody({ title, contextLine, sourceText: processed.sourceText, items: processed.items, totals: processed.totals, goalLines });
}

export function buildWhatsAppConsolidatedMealReplyMessage(meal: WhatsAppConsolidatedMealReplyInput, options: WhatsAppMealReplyOptions = {}) {
  const registeredAt = options.registeredAt ?? normalizeReplyDate(meal.occurredAt);
  const timeZone = options.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const title = buildMealTitle(meal.mealLabel, registeredAt, true, timeZone);
  const contextLine = buildWhatsAppMealContextLine(meal.mealLabel, registeredAt, timeZone);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, registeredAt, timeZone);
  return buildMealReplyBody({ title, contextLine, items: meal.items, totals: sumReplyItems(meal.items), goalLines });
}

export function buildWhatsAppMealActionReplyMessage(meal: WhatsAppConsolidatedMealReplyInput, options: WhatsAppMealActionReplyOptions) {
  const registeredAt = options.registeredAt ?? normalizeReplyDate(meal.occurredAt);
  const timeZone = options.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const goalLines = buildMealGoalProgressLines(options.goalProgress, registeredAt, timeZone);
  const actionLines = options.actionLines?.filter(Boolean).map(normalizeActionLine) ?? [];
  const mealResultLabel = options.mealResultState === "registered" ? "Refeição registrada:" : "Refeição atualizada:";

  return buildWhatsAppBlock([
    buildWhatsAppTitle(options.title, { bold: true }),
    ...(actionLines.length ? [buildWhatsAppSeparator(), ...actionLines] : []),
    buildWhatsAppSeparator(),
    mealResultLabel,
    buildWhatsAppMealContextLine(meal.mealLabel, registeredAt, timeZone),
    ...buildMealItemLines(meal.items),
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(sumReplyItems(meal.items)),
    ...(goalLines.length ? [buildWhatsAppSeparator(), ...goalLines] : []),
  ]);
}
