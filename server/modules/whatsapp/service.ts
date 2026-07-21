import {
  getAdminWhatsAppTokenStatus,
  getUserWhatsappConnection,
  logInferenceEvent,
  upsertUserWhatsappConnection,
} from "../../db";
import { processMealDraft } from "../meals/service";
import { processProfessionalAccessWhatsappResponse } from "../professionals/service";
import {
  getMissingWhatsAppChannelConfig,
  getWhatsAppChannelConfig,
  normalizeWhatsAppPhoneNumber,
} from "../../whatsappConfig";
import { normalizeTextMeasurementUnits } from "../../../shared/measurementUnits";
import { SimulateWhatsappInboundInput, WhatsappConnectionInput } from "./schemas";
import {
  getWhatsappConversationPendingContext,
  registerWhatsappConversationPendingContext,
  resolveWhatsappConversationContext,
} from "./conversationContext";
import { executeWhatsappAiQuestionIntent } from "./aiQuestionAssistant";
import { executeWhatsappDatedFoodAdditionIntent } from "./datedFoodAdditionIntent";
import { executeWhatsappDeleteIntent } from "./deleteIntent";
import { executeWhatsAppFoodAssistantIntent } from "./foodAssistant";
import { handleWhatsappFoodClarification } from "./foodClarification";
import {
  buildWhatsappDuplicateInboundResult,
  evaluateWhatsappInboundIdempotency,
} from "./inboundIdempotencyGuard";
import { executeWhatsappTextIntent } from "./intentActions";
import { executeWhatsappLlmIntent } from "./llmIntentActions";
import { executeWhatsappMultiActionIntent } from "./multiActionIntent";
import { supersedeActiveWhatsappPendingOperations } from "./pendingOperationPrecedence";
import {
  buildWhatsappRouterResult,
  evaluateWhatsappIntentRoute,
  type WhatsappIntentRouteDecision,
} from "./intentRouter";
import { getWhatsAppIntentLogStatus } from "./intentResult";
import { executeWhatsappRecordAdjustmentIntent } from "./recordAdjustmentIntent";
import { executeWhatsappGramsAdjustmentIntent } from "./gramsAdjustmentIntent";
import { executeWhatsappGramsIncrementIntent } from "./gramsIncrementIntent";
import { resolveWhatsappTemporalContext } from "./temporalContext";
import { isWhatsAppWaterOnlyText, splitWhatsAppWaterAndFoodText } from "./waterFoodText";
import { resolveInjectedWhatsAppTimeZone } from "./timeZoneContext";

export class OfficialWhatsappNumberError extends Error {
  constructor() {
    super("Informe o telefone de origem do usuário final, não o número oficial fixo da solução.");
    this.name = "OfficialWhatsappNumberError";
  }
}

export async function getWhatsappStatus(userId: number) {
  const tokenStatus = await getAdminWhatsAppTokenStatus();
  const channelConfig = getWhatsAppChannelConfig();
  const missingConfig = [
    ...getMissingWhatsAppChannelConfig(channelConfig),
    ...(tokenStatus.configured ? [] : ["WHATSAPP_ACCESS_TOKEN"]),
  ];

  return {
    configured: missingConfig.length === 0,
    webhookPath: "/api/whatsapp/webhook",
    currentUserId: userId,
    connection: await getUserWhatsappConnection(userId),
    accessTokenSource: tokenStatus.source,
    channel: {
      phoneNumber: channelConfig.solutionPhoneNumber,
      phoneNumberId: channelConfig.phoneNumberId,
      businessAccountId: channelConfig.businessAccountId,
    },
    missingConfig,
  };
}

export async function updateWhatsappConnection(userId: number, input: WhatsappConnectionInput) {
  const channelConfig = getWhatsAppChannelConfig();
  const normalizedContactPhone = normalizeWhatsAppPhoneNumber(input.phoneNumber);
  if (channelConfig.solutionPhoneNumber && normalizedContactPhone === channelConfig.solutionPhoneNumber) {
    throw new OfficialWhatsappNumberError();
  }

  const connection = await upsertUserWhatsappConnection({
    userId,
    phoneNumber: input.phoneNumber,
    displayName: input.displayName,
  });

  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "whatsapp.connection_updated",
    detail: `Contato final ${connection.phoneNumber} vinculado ao usuário para processamento automático do WhatsApp.`,
  });

  return connection;
}

async function logAndReturnInterpretedIntent(
  userId: number,
  interpreted: {
    action: string;
    eventType: string;
    detail: string;
    reply?: string;
    data?: Record<string, unknown>;
  } | null,
  input?: { text?: string | null; receivedAt?: Date },
) {
  if (!interpreted) {
    return null;
  }

  registerWhatsappConversationPendingContext(userId, {
    ...interpreted,
    reply: interpreted.reply ?? interpreted.detail,
  }, input);
  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: getWhatsAppIntentLogStatus(interpreted.action),
    eventType: interpreted.eventType,
    detail: interpreted.detail,
  });
  return interpreted;
}

function logAndReturnRouterResult(userId: number, route: WhatsappIntentRouteDecision) {
  const result = buildWhatsappRouterResult(route);
  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: route.action === "safe_non_food_response" ? "success" : "warning",
    eventType: result.eventType,
    detail: result.detail,
  });
  return result;
}

function logAndReturnTemporalClarification(userId: number, clarification: NonNullable<ReturnType<typeof resolveWhatsappTemporalContext>["clarification"]>) {
  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: "warning",
    eventType: clarification.eventType,
    detail: clarification.detail,
  });
  return clarification;
}

function logTemporalResolution(userId: number, context: NonNullable<ReturnType<typeof resolveWhatsappTemporalContext>["context"]>) {
  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: context.timezoneSource === "fallback" ? "warning" : "success",
    eventType: "whatsapp.time.temporal_context_resolved",
    detail: `Referencia temporal "${context.temporalExpression}" resolvida para ${context.resolvedDate} usando ${context.userTimezone}.`,
  });
}

function buildPendingReplacementBlockedResult() {
  return {
    handled: true as const,
    action: "clarification_needed",
    reply: "Não consegui substituir a ação pendente com segurança. Nada foi alterado. Cancele a ação anterior e envie novamente o novo comando.",
    eventType: "whatsapp.pending_operation_replacement_blocked",
    detail: "Novo comando completo bloqueado porque uma pendência anterior não pôde ser marcada como substituída.",
    data: {
      fallbackBlocked: true,
      fallbackBlockReason: "pending_replacement_failed",
      pendingState: "blocked",
    },
  };
}

function buildMultiActionValidationBlockedResult() {
  return {
    handled: true as const,
    action: "clarification_needed",
    reply: "Não consegui validar todas as ações do comando composto com segurança. Nada foi alterado; envie as ações separadamente.",
    eventType: "whatsapp.multi_action.validation_blocked",
    detail: "Comando composto reconhecido na pré-classificação, mas não confirmado na resolução final; fallback nutricional bloqueado.",
    data: {
      fallbackBlocked: true,
      fallbackBlockReason: "multi_action_validation_failed",
      pendingState: "blocked",
    },
  };
}

function normalizeContextReplyText(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function isShortContextReply(value?: string | null) {
  const text = normalizeContextReplyText(value);
  return /^(?:s|sim|ok|confirmo|confirmar|pode|pode sim|isso|certo|n|nao|negativo|cancela|cancelar|nenhuma|nenhum|0|opcao\s*\d+|\d+)$/.test(text);
}

function normalizeMealTemporalText(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function shouldBypassTextIntentForExplicitMealDate(
  text: string | null | undefined,
  context: NonNullable<ReturnType<typeof resolveWhatsappTemporalContext>["context"]> | null,
) {
  if (!context || context.dateKind === "today" || !context.mealSlot) {
    return false;
  }

  const normalized = normalizeMealTemporalText(text);
  return /\b(?:adicionar|adiciona|adicione|incluir|inclui|inclua|registrar|registra|registre|acrescentar|acrescenta|acrescente|colocar|coloca|coloque)\b/.test(normalized)
    || /\b(?:xicaras?|cafe|capsulas?|porcoes?|porcao|fatias?|gramas?|g|ml)\b/.test(normalized);
}

function shouldSkipTextIdempotencyForContextReply(userId: number, text?: string | null, receivedAt?: Date) {
  return Boolean(getWhatsappConversationPendingContext(userId, receivedAt) && isShortContextReply(text));
}

async function handleProfessionalAccessDecision(userId: number, text?: string | null) {
  if (!text) return null;
  const professionalAccessResponse = await processProfessionalAccessWhatsappResponse(userId, text);
  if (!professionalAccessResponse) return null;

  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: professionalAccessResponse.action === "professional_access_decision_ambiguous" ? "warning" : "success",
    eventType: professionalAccessResponse.eventType,
    detail: professionalAccessResponse.detail,
  });
  return professionalAccessResponse;
}

export async function simulateWhatsappInbound(userId: number, input: SimulateWhatsappInboundInput) {
  const text = input.text ? normalizeTextMeasurementUnits(input.text) : input.text;
  const receivedAt = input.receivedAt ?? new Date();
  const skipTextDedupe = shouldSkipTextIdempotencyForContextReply(userId, text, receivedAt);
  const idempotencyDecision = evaluateWhatsappInboundIdempotency({
    userId,
    messageId: input.messageId,
    text,
    receivedAt,
    duplicateWindowMs: skipTextDedupe ? 0 : undefined,
  });

  if (!idempotencyDecision.shouldProcess) {
    const duplicateResult = buildWhatsappDuplicateInboundResult(idempotencyDecision);
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: duplicateResult.eventType,
      detail: duplicateResult.detail,
    });
    return duplicateResult;
  }

  const timeZoneResolution = resolveInjectedWhatsAppTimeZone(input.userTimezone);
  const userTimezone = timeZoneResolution.timeZone;
  const timezoneSource = timeZoneResolution.source === "profile" ? "configured" : "fallback";

  const aiQuestion = await executeWhatsappAiQuestionIntent(userId, {
    text,
    receivedAt,
    userTimezone,
  });
  if (aiQuestion) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: aiQuestion.action === "ai_question_answered" ? "success" : "warning",
      eventType: aiQuestion.eventType,
      detail: aiQuestion.detail,
    });
    return aiQuestion;
  }

  // A pendência operacional alimentar precisa ser consultada antes do contexto
  // conversacional em memória, pois respostas curtas como SIM, REGISTRAR ou uma
  // quantidade pertencem ao registro original persistido (issue #855).
  const foodClarification = await logAndReturnInterpretedIntent(userId, await handleWhatsappFoodClarification({
    userId,
    text,
    receivedAt,
    userTimezone,
    messageId: input.messageId,
  }), { text, receivedAt });
  if (foodClarification) {
    return foodClarification;
  }

  const contextResult = await logAndReturnInterpretedIntent(userId, resolveWhatsappConversationContext(userId, {
    text,
    receivedAt,
  }), { text, receivedAt });
  if (contextResult) {
    return contextResult;
  }

  // O coordenador de múltiplas ações é um ramo fail-closed próprio: só existe
  // quando há duas ou mais ações explícitas e nunca executa domínio diretamente.
  // Mensagens que não formam um comando composto seguem primeiro para o executor
  // destrutivo canônico, inclusive respostas inválidas de pendências ativas.
  const multiActionPreview = executeWhatsappMultiActionIntent({ text, temporalContext: null });
  if (multiActionPreview) {
    const pendingWasReplaced = await supersedeActiveWhatsappPendingOperations(userId, receivedAt);
    if (!pendingWasReplaced) {
      return logAndReturnInterpretedIntent(userId, buildPendingReplacementBlockedResult(), { text, receivedAt });
    }
  } else {
    const deleteIntentResult = await logAndReturnInterpretedIntent(userId, await executeWhatsappDeleteIntent(userId, {
      text,
      receivedAt,
      timeZone: userTimezone,
      entrypoint: "simulateWhatsappInbound",
    }), { text, receivedAt });
    if (deleteIntentResult) {
      return deleteIntentResult;
    }
  }

  const temporalResolution = resolveWhatsappTemporalContext({
    text,
    receivedAt,
    userTimezone,
    timezoneSource,
  });
  if (temporalResolution.clarification) {
    return logAndReturnTemporalClarification(userId, temporalResolution.clarification);
  }
  if (temporalResolution.context) {
    logTemporalResolution(userId, temporalResolution.context);
  }

  if (multiActionPreview) {
    const multiAction = await logAndReturnInterpretedIntent(userId, executeWhatsappMultiActionIntent({
      text,
      temporalContext: temporalResolution.context,
    }), { text, receivedAt });
    return multiAction
      ?? logAndReturnInterpretedIntent(userId, buildMultiActionValidationBlockedResult(), { text, receivedAt });
  }

  const professionalAccessResponse = await handleProfessionalAccessDecision(userId, text);
  if (professionalAccessResponse) {
    return professionalAccessResponse;
  }

  const route = evaluateWhatsappIntentRoute({
    text,
    pendingContextKind: input.pendingContextKind,
  });
  if (route.action !== "continue_pipeline") {
    return logAndReturnRouterResult(userId, route);
  }

  const datedFoodAddition = await logAndReturnInterpretedIntent(userId, await executeWhatsappDatedFoodAdditionIntent(userId, {
    text,
    receivedAt,
    userTimezone,
  }), { text, receivedAt });
  if (datedFoodAddition) {
    return temporalResolution.context
      ? { ...datedFoodAddition, data: { ...datedFoodAddition.data, temporalContext: temporalResolution.context } }
      : datedFoodAddition;
  }

  const waterFoodSplit = splitWhatsAppWaterAndFoodText(text);
  if (waterFoodSplit) {
    const waterResults = [];
    for (const waterLine of waterFoodSplit.waterLines) {
      const interpretedWater = await executeWhatsappTextIntent(userId, {
        text: waterLine.text,
        receivedAt,
        userTimezone,
      });
      if (!interpretedWater) {
        throw new Error(`Não foi possível registrar a hidratação informada em "${waterLine.text}".`);
      }

      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: getWhatsAppIntentLogStatus(interpretedWater.action),
        eventType: interpretedWater.eventType,
        detail: interpretedWater.detail,
      });
      waterResults.push(interpretedWater);
    }

    const meal = await processMealDraft(userId, {
      source: "whatsapp",
      text: waterFoodSplit.foodText,
    }, userTimezone);

    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.water_and_food_multiline_detected",
      detail: "Mensagem multi-linha com hidratação e alimentos foi separada antes do processamento da refeição.",
    });

    return {
      handled: true,
      action: "water_and_meal_logged",
      reply: "Registrei a hidratação e encaminhei os alimentos para revisão da refeição.",
      eventType: "whatsapp.intent.water_and_food_multiline_detected",
      detail: "Hidratação e alimentos processados a partir de uma mensagem multi-linha.",
      data: {
        waterLogs: waterResults.map((result) => result.data),
        foodText: waterFoodSplit.foodText,
        temporalContext: temporalResolution.context,
      },
      water: waterResults,
      meal,
    };
  }

  const waterCorrectionMatch = text ? /\b(?:n[aã]o)\s+(?:é|e|era)\s+(.+?)\s+(?:é|e|era)\s+(.+)$/i.exec(text) : null;
  if (waterCorrectionMatch) {
    const fromText = waterCorrectionMatch[1].trim();
    const toText = waterCorrectionMatch[2].trim();
    if (isWhatsAppWaterOnlyText(fromText) && toText) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.intent.food_correction_text_detected",
        detail: "Correção de texto detectada: hidratação foi substituída por alimento antes do processamento nutricional.",
      });
      return processMealDraft(userId, { source: "whatsapp", text: toText }, userTimezone);
    }
  }

  const gramsAdjustment = await logAndReturnInterpretedIntent(userId, await executeWhatsappGramsAdjustmentIntent(userId, {
    text,
    receivedAt,
    userTimezone,
  }), { text, receivedAt });
  if (gramsAdjustment) {
    return temporalResolution.context
      ? { ...gramsAdjustment, data: { ...gramsAdjustment.data, temporalContext: temporalResolution.context } }
      : gramsAdjustment;
  }

  const gramsIncrement = await logAndReturnInterpretedIntent(userId, await executeWhatsappGramsIncrementIntent(userId, {
    text,
    receivedAt,
    userTimezone,
  }), { text, receivedAt });
  if (gramsIncrement) {
    return temporalResolution.context
      ? { ...gramsIncrement, data: { ...gramsIncrement.data, temporalContext: temporalResolution.context } }
      : gramsIncrement;
  }

  const recordAdjustment = await logAndReturnInterpretedIntent(userId, await executeWhatsappRecordAdjustmentIntent(userId, {
    text,
    receivedAt,
    userTimezone: temporalResolution.context?.userTimezone ?? userTimezone,
  }), { text, receivedAt });
  if (recordAdjustment) {
    return temporalResolution.context
      ? { ...recordAdjustment, data: { ...recordAdjustment.data, temporalContext: temporalResolution.context } }
      : recordAdjustment;
  }

  const interpreted = shouldBypassTextIntentForExplicitMealDate(text, temporalResolution.context)
    ? null
    : await logAndReturnInterpretedIntent(userId, await executeWhatsappTextIntent(userId, {
      text,
      receivedAt,
      userTimezone,
      messageId: input.messageId,
    }), { text, receivedAt });
  if (interpreted) {
    return temporalResolution.context
      ? { ...interpreted, data: { ...interpreted.data, temporalContext: temporalResolution.context } }
      : interpreted;
  }

  const llmRaw = await executeWhatsappLlmIntent(userId, { text, receivedAt, messageId: input.messageId, userTimezone });
  // WhatsappLlmNutritionFallback (handled: false) não é um resultado de intent tratado — ignorar aqui
  const llmInterpreted = await logAndReturnInterpretedIntent(userId, llmRaw && "handled" in llmRaw && !llmRaw.handled ? null : llmRaw as Exclude<typeof llmRaw, { handled: false }>, { text, receivedAt });
  if (llmInterpreted) {
    return temporalResolution.context
      ? { ...llmInterpreted, data: { ...llmInterpreted.data, temporalContext: temporalResolution.context } }
      : llmInterpreted;
  }

  const assistant = executeWhatsAppFoodAssistantIntent(text);
  if (assistant) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: assistant.eventType,
      detail: assistant.detail,
    });
    return temporalResolution.context
      ? { ...assistant, data: { ...assistant.data, temporalContext: temporalResolution.context } }
      : assistant;
  }

  if (!route.shouldAllowNutritionFallback) {
    return logAndReturnRouterResult(userId, route);
  }

  const meal = await processMealDraft(userId, { source: "whatsapp", text }, userTimezone);
  return temporalResolution.context
    ? { ...meal, temporalContext: temporalResolution.context }
    : meal;
}
