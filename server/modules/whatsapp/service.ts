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
import { SimulateWhatsappInboundInput, WhatsappConnectionInput } from "./schemas";
import {
  getActiveWhatsappConversationContext,
  registerWhatsappConversationContextFromResult,
  resolveWhatsappConversationContext,
} from "./conversationContext";
import { executeWhatsAppFoodAssistantIntent } from "./foodAssistant";
import { buildWhatsappDuplicateInboundResponse, checkWhatsappInboundIdempotency } from "./idempotencyGuard";
import { executeWhatsappTextIntent } from "./intentActions";
import { executeWhatsappLlmIntent } from "./llmIntentActions";
import { getWhatsAppIntentLogStatus } from "./intentResult";
import { detectWhatsappMultiActionSegments, type WhatsappMultiActionSegment } from "./multiAction";
import { routeWhatsappMessageBeforeNutrition } from "./intentRouter";
import { normalizeWhatsappMultimodalInput } from "./multimodalNormalizer";
import { recordWhatsappOperationalTraceStep, startWhatsappOperationalTrace } from "./operationalTrace";
import { executeWhatsappRecordAdjustmentIntent } from "./recordAdjustmentIntent";
import { buildWhatsappTimeReferenceClarification, resolveWhatsappTimeReferences } from "./timeReferenceResolver";
import { isWhatsAppWaterOnlyText, splitWhatsAppWaterAndFoodText } from "./waterFoodText";

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

function elapsedSince(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

async function logAndReturnInterpretedIntent(
  userId: number,
  interpreted: {
    action: string;
    eventType: string;
    detail: string;
  } | null,
) {
  if (!interpreted) {
    return null;
  }

  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: getWhatsAppIntentLogStatus(interpreted.action),
    eventType: interpreted.eventType,
    detail: interpreted.detail,
  });
  return interpreted;
}

function buildMultimodalClarification(normalized: Awaited<ReturnType<typeof normalizeWhatsappMultimodalInput>>) {
  return {
    handled: true,
    action: "multimodal_clarification_needed",
    reply: normalized.clarificationQuestion ?? "Preciso de mais contexto para entender essa mensagem com segurança.",
    eventType: "whatsapp.multimodal.clarification_needed",
    detail: normalized.historyDetail,
    data: {
      inputModality: normalized.inputModality,
      mediaKind: normalized.mediaContext?.mediaKind ?? null,
      extractionPerformed: normalized.extraction.performed,
      extractionConfidence: normalized.extraction.confidence,
    },
  };
}

function logDuplicateInbound(userId: number, duplicateResponse: ReturnType<typeof buildWhatsappDuplicateInboundResponse>) {
  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: "warning",
    eventType: duplicateResponse.eventType,
    detail: duplicateResponse.detail,
  });
  return duplicateResponse;
}

function registerConversationContext(userId: number, text: string, receivedAt: Date, result: { action: string; data?: Record<string, unknown> } | null | undefined) {
  const pendingContext = registerWhatsappConversationContextFromResult(userId, {
    text,
    result,
    receivedAt,
  });
  if (pendingContext) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.context.pending_created",
      detail: `Pendência conversacional ${pendingContext.kind} criada para a próxima mensagem do WhatsApp.`,
    });
  }
  return pendingContext;
}

type WhatsappPipelineLikeResult = {
  action?: unknown;
  reply?: unknown;
  eventType?: unknown;
  detail?: unknown;
  data?: unknown;
  draftId?: unknown;
};

type WhatsappMultiActionItemResult = {
  index: number;
  text: string;
  action: string;
  status: "success" | "warning";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function summarizeActionResult(segment: WhatsappMultiActionSegment, result: unknown): WhatsappMultiActionItemResult {
  const candidate = (isRecord(result) ? result : {}) as WhatsappPipelineLikeResult;
  const action = typeof candidate.action === "string" ? candidate.action : "meal_logged";
  const eventType = typeof candidate.eventType === "string" ? candidate.eventType : "whatsapp.multi_action.meal_logged";
  const detail = typeof candidate.detail === "string" ? candidate.detail : "Trecho de multi-ação encaminhado para processamento nutricional.";
  const data = isRecord(candidate.data) ? candidate.data : null;
  const status = /(?:clarification|confirmation|selection)_needed$/.test(action) || action === "router_clarification_needed" ? "warning" : "success";
  const reply = typeof candidate.reply === "string" && candidate.reply.trim()
    ? candidate.reply.trim()
    : action === "meal_logged"
      ? "Encaminhei este item para revisão da refeição."
      : "Ação interpretada com segurança.";

  return {
    index: segment.index,
    text: segment.text,
    action,
    status,
    reply,
    eventType,
    detail,
    data,
  };
}

function shouldOpenConversationContextForMultiAction(action: string) {
  return action.endsWith("_selection_needed") || action.endsWith("_confirmation_needed");
}

function buildMultiActionReply(results: WhatsappMultiActionItemResult[], pendingContextCount: number) {
  const lines = results.map(result => {
    if (result.action === "meal_logged") {
      return `${result.index}. ${result.text}: encaminhei para revisão da refeição.`;
    }
    if (result.action.endsWith("_confirmation_needed")) {
      return `${result.index}. ${result.text}: precisa de confirmação antes de alterar.`;
    }
    if (result.action.endsWith("_selection_needed")) {
      return `${result.index}. ${result.text}: preciso que você escolha uma opção.`;
    }
    if (result.status === "warning") {
      return `${result.index}. ${result.text}: preciso de mais uma informação.`;
    }
    return `${result.index}. ${result.text}: concluído.`;
  });

  const suffix = pendingContextCount > 1
    ? "\n\nAlgumas ações precisam de confirmação ou escolha. Envie cada confirmação separadamente para eu não alterar o alvo errado."
    : "";
  return [`Processei ${results.length} ações da sua mensagem:`, ...lines].join("\n") + suffix;
}

async function processWhatsappMultiActionSegments(input: {
  userId: number;
  text: string;
  receivedAt: Date;
  segments: WhatsappMultiActionSegment[];
  trace: ReturnType<typeof startWhatsappOperationalTrace>;
  originalInput: SimulateWhatsappInboundInput;
  normalizedInput: Awaited<ReturnType<typeof normalizeWhatsappMultimodalInput>>;
  activeContext: ReturnType<typeof getActiveWhatsappConversationContext>;
}) {
  const results: WhatsappMultiActionItemResult[] = [];
  const contextCandidates: { text: string; result: WhatsappMultiActionItemResult }[] = [];

  for (const segment of input.segments) {
    const recordAdjustmentStartedAt = Date.now();
    const recordAdjustment = await executeWhatsappRecordAdjustmentIntent(input.userId, {
      text: segment.text,
      receivedAt: input.receivedAt,
    });
    recordWhatsappOperationalTraceStep(input.trace, {
      stage: "record_adjustment",
      status: recordAdjustment ? "warning" : "fallback",
      durationMs: elapsedSince(recordAdjustmentStartedAt),
      intent: recordAdjustment?.action,
      fallbackReason: recordAdjustment ? "multi_action_record_adjustment" : "record_adjustment_not_handled",
      metadata: {
        multiActionIndex: segment.index,
      },
    });

    if (recordAdjustment) {
      logInferenceEvent({
        userId: input.userId,
        origin: "whatsapp",
        status: getWhatsAppIntentLogStatus(recordAdjustment.action),
        eventType: recordAdjustment.eventType,
        detail: recordAdjustment.detail,
      });
      const summarized = summarizeActionResult(segment, recordAdjustment);
      results.push(summarized);
      if (shouldOpenConversationContextForMultiAction(summarized.action)) {
        contextCandidates.push({ text: segment.text, result: summarized });
      }
      continue;
    }

    const routerStartedAt = Date.now();
    const routerDecision = routeWhatsappMessageBeforeNutrition({
      text: segment.text,
      messageId: input.originalInput.messageId,
      inputModality: input.normalizedInput.inputModality,
      pendingContextId: input.activeContext?.id,
      pendingContextKind: input.activeContext?.kind,
      actorId: input.userId,
      targetUserId: input.userId,
    });
    recordWhatsappOperationalTraceStep(input.trace, {
      stage: "canonical_router",
      status: routerDecision.shouldUseNutritionFallback ? "success" : "warning",
      durationMs: elapsedSince(routerStartedAt),
      schemaVersion: routerDecision.canonical.schema_version,
      processingStrategy: routerDecision.canonical.processing_strategy ?? undefined,
      intent: routerDecision.canonical.intent,
      fallbackReason: routerDecision.reason,
      metadata: {
        multiActionIndex: segment.index,
        shouldUseNutritionFallback: routerDecision.shouldUseNutritionFallback,
        needsConfirmation: routerDecision.canonical.needs_confirmation,
        confidence: routerDecision.canonical.confidence,
      },
    });

    if (!routerDecision.shouldUseNutritionFallback && routerDecision.response) {
      logInferenceEvent({
        userId: input.userId,
        origin: "whatsapp",
        status: "warning",
        eventType: routerDecision.response.eventType,
        detail: routerDecision.response.detail,
      });
      results.push(summarizeActionResult(segment, routerDecision.response));
      continue;
    }

    const mealStartedAt = Date.now();
    const meal = await processMealDraft(input.userId, { source: "whatsapp", text: segment.text });
    recordWhatsappOperationalTraceStep(input.trace, {
      stage: "nutrition_persistence",
      status: "success",
      durationMs: elapsedSince(mealStartedAt),
      toolNames: ["meal_create"],
      metadata: {
        multiActionIndex: segment.index,
      },
    });
    results.push(summarizeActionResult(segment, meal));
  }

  let pendingContext = null;
  if (contextCandidates.length === 1) {
    pendingContext = registerConversationContext(input.userId, contextCandidates[0].text, input.receivedAt, contextCandidates[0].result);
    if (pendingContext) {
      recordWhatsappOperationalTraceStep(input.trace, {
        stage: "conversation_context",
        status: "success",
        durationMs: 0,
        intent: "context_registered",
        metadata: {
          contextKind: pendingContext.kind,
          optionCount: pendingContext.options.length,
        },
      });
    }
  }

  const warningCount = results.filter(result => result.status === "warning").length;
  const response = {
    handled: true,
    action: "multi_action_processed",
    reply: buildMultiActionReply(results, contextCandidates.length),
    eventType: "whatsapp.multi_action.processed",
    detail: `Mensagem do WhatsApp decomposta em ${results.length} ações; ${warningCount} exigem confirmação, escolha ou esclarecimento.`,
    data: {
      actionCount: results.length,
      warningCount,
      pendingContextCount: contextCandidates.length,
      pendingContextRegistered: Boolean(pendingContext),
      actions: results.map(result => ({
        index: result.index,
        text: result.text,
        action: result.action,
        status: result.status,
        eventType: result.eventType,
        detail: result.detail,
        data: result.data,
      })),
    },
  };

  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: warningCount ? "warning" : "success",
    eventType: response.eventType,
    detail: response.detail,
  });
  return response;
}

export async function simulateWhatsappInbound(userId: number, input: SimulateWhatsappInboundInput) {
  const receivedAt = new Date();
  const trace = startWhatsappOperationalTrace({
    userId,
    messageText: input.text ?? input.media?.caption ?? input.media?.transcription ?? input.media?.imageDescription ?? null,
    messageId: input.messageId,
    eventId: input.eventId,
    createdAt: receivedAt,
  });

  const normalizationStartedAt = Date.now();
  const normalizedInput = await normalizeWhatsappMultimodalInput(input);
  recordWhatsappOperationalTraceStep(trace, {
    stage: "normalization",
    status: normalizedInput.needsClarification ? "warning" : "success",
    durationMs: elapsedSince(normalizationStartedAt),
    ruleVersion: "whatsapp-normalization-v1",
    metadata: {
      inputModality: normalizedInput.inputModality,
      mediaKind: normalizedInput.mediaContext?.mediaKind ?? null,
      extractionPerformed: normalizedInput.extraction.performed,
      extractionConfidence: normalizedInput.extraction.confidence,
      informalMatches: normalizedInput.informalNormalization.matches.length,
      candidateAliases: normalizedInput.informalNormalization.candidateAliases.length,
    },
  });
  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: normalizedInput.needsClarification ? "warning" : "success",
    eventType: "whatsapp.multimodal.normalized",
    detail: normalizedInput.historyDetail,
  });

  if (normalizedInput.needsClarification) {
    recordWhatsappOperationalTraceStep(trace, {
      stage: "response",
      status: "warning",
      durationMs: 0,
      fallbackReason: "normalization_clarification",
    });
    return buildMultimodalClarification(normalizedInput);
  }

  let text = normalizedInput.routerText ?? undefined;
  if (!text) {
    recordWhatsappOperationalTraceStep(trace, {
      stage: "response",
      status: "warning",
      durationMs: 0,
      fallbackReason: "empty_normalized_input",
    });
    return buildMultimodalClarification({
      ...normalizedInput,
      needsClarification: true,
      clarificationQuestion: "Me envie um texto, áudio ou imagem com contexto para eu registrar ou consultar sua alimentação.",
      historyDetail: "Entrada vazia recebida antes do roteador do WhatsApp.",
    });
  }

  const idempotencyStartedAt = Date.now();
  const idempotencyDecision = checkWhatsappInboundIdempotency({
    userId,
    text,
    messageId: input.messageId,
    eventId: input.eventId,
    receivedAt,
    allowIntentionalDuplicate: input.allowIntentionalDuplicate,
  });
  recordWhatsappOperationalTraceStep(trace, {
    stage: "idempotency",
    status: idempotencyDecision.duplicate ? "warning" : "success",
    durationMs: elapsedSince(idempotencyStartedAt),
    ruleVersion: "whatsapp-idempotency-v1",
    fallbackReason: idempotencyDecision.duplicate ? idempotencyDecision.kind : undefined,
    metadata: {
      duplicate: idempotencyDecision.duplicate,
      duplicateKind: idempotencyDecision.kind,
      allowIntentionalDuplicate: Boolean(input.allowIntentionalDuplicate),
    },
  });
  if (idempotencyDecision.duplicate) {
    recordWhatsappOperationalTraceStep(trace, {
      stage: "response",
      status: "warning",
      durationMs: 0,
      fallbackReason: idempotencyDecision.kind,
    });
    return logDuplicateInbound(userId, buildWhatsappDuplicateInboundResponse(idempotencyDecision));
  }

  const contextStartedAt = Date.now();
  const contextResponse = resolveWhatsappConversationContext(userId, { text, receivedAt });
  const activeContext = getActiveWhatsappConversationContext(userId, receivedAt);
  recordWhatsappOperationalTraceStep(trace, {
    stage: "conversation_context",
    status: contextResponse ? "success" : activeContext ? "warning" : "skipped",
    durationMs: elapsedSince(contextStartedAt),
    intent: contextResponse?.action,
    fallbackReason: contextResponse ? undefined : activeContext ? "context_active_not_consumed" : "no_active_context",
    metadata: {
      hasActiveContext: Boolean(activeContext),
      contextKind: activeContext?.kind ?? null,
    },
  });
  if (contextResponse) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: getWhatsAppIntentLogStatus(contextResponse.action),
      eventType: contextResponse.eventType,
      detail: contextResponse.detail,
    });
    recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "success", durationMs: 0 });
    return contextResponse;
  }

  if (text) {
    const professionalStartedAt = Date.now();
    const professionalAccessResponse = await processProfessionalAccessWhatsappResponse(userId, text);
    recordWhatsappOperationalTraceStep(trace, {
      stage: "professional_access",
      status: professionalAccessResponse ? "success" : "skipped",
      durationMs: elapsedSince(professionalStartedAt),
    });
    if (professionalAccessResponse) {
      recordWhatsappOperationalTraceStep(trace, {
        stage: "response",
        status: professionalAccessResponse.action === "professional_access_decision_ambiguous" ? "warning" : "success",
        durationMs: 0,
      });
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: professionalAccessResponse.action === "professional_access_decision_ambiguous" ? "warning" : "success",
        eventType: professionalAccessResponse.eventType,
        detail: professionalAccessResponse.detail,
      });
      return professionalAccessResponse;
    }
  }

  const timeReferenceStartedAt = Date.now();
  const timeReference = await resolveWhatsappTimeReferences(userId, { text, receivedAt });
  recordWhatsappOperationalTraceStep(trace, {
    stage: "time_reference",
    status: timeReference.ambiguous ? "warning" : timeReference.timeReference || timeReference.mealReference ? "success" : "skipped",
    durationMs: elapsedSince(timeReferenceStartedAt),
    ruleVersion: "whatsapp-time-reference-v1",
    fallbackReason: timeReference.ambiguous ? "ambiguous_time_reference" : undefined,
    metadata: {
      changed: timeReference.changed,
      dateKey: timeReference.timeReference?.dateKey ?? null,
      timezone: timeReference.timeReference?.timezone ?? null,
      timezoneFallbackUsed: timeReference.timeReference?.timezoneFallbackUsed ?? null,
      mealLabel: timeReference.mealReference?.mealLabel ?? null,
    },
  });
  if (timeReference.ambiguous) {
    const response = buildWhatsappTimeReferenceClarification(timeReference);
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: response.eventType,
      detail: response.detail,
    });
    recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "warning", durationMs: 0, fallbackReason: "ambiguous_time_reference" });
    return response;
  }
  if (timeReference.timeReference || timeReference.mealReference) {
    text = timeReference.text;
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.time_reference.resolved",
      detail: timeReference.historyDetail,
    });
  }

  const multiActionStartedAt = Date.now();
  const multiActionSegments = detectWhatsappMultiActionSegments(text);
  recordWhatsappOperationalTraceStep(trace, {
    stage: "multi_action",
    status: multiActionSegments ? "success" : "skipped",
    durationMs: elapsedSince(multiActionStartedAt),
    ruleVersion: "whatsapp-multi-action-v1",
    fallbackReason: multiActionSegments ? undefined : "single_action_message",
    metadata: {
      actionCount: multiActionSegments?.length ?? 1,
    },
  });
  if (multiActionSegments) {
    const multiActionResult = await processWhatsappMultiActionSegments({
      userId,
      text,
      receivedAt,
      segments: multiActionSegments,
      trace,
      originalInput: input,
      normalizedInput,
      activeContext,
    });
    recordWhatsappOperationalTraceStep(trace, {
      stage: "response",
      status: multiActionResult.data.warningCount ? "warning" : "success",
      durationMs: 0,
      fallbackReason: multiActionResult.data.warningCount ? "multi_action_partial_confirmation" : undefined,
    });
    return multiActionResult;
  }

  const waterFoodStartedAt = Date.now();
  const waterFoodSplit = splitWhatsAppWaterAndFoodText(text);
  recordWhatsappOperationalTraceStep(trace, {
    stage: "water_food_split",
    status: waterFoodSplit ? "success" : "skipped",
    durationMs: elapsedSince(waterFoodStartedAt),
    ruleVersion: "whatsapp-water-food-split-v1",
    metadata: {
      waterLineCount: waterFoodSplit?.waterLines.length ?? 0,
    },
  });
  if (waterFoodSplit) {
    const waterResults = [];
    for (const waterLine of waterFoodSplit.waterLines) {
      const waterStartedAt = Date.now();
      const interpretedWater = await executeWhatsappTextIntent(userId, {
        text: waterLine.text,
        receivedAt,
      });
      recordWhatsappOperationalTraceStep(trace, {
        stage: "deterministic_intent",
        status: interpretedWater ? "success" : "error",
        durationMs: elapsedSince(waterStartedAt),
        intent: "water_logged",
        errorCode: interpretedWater ? undefined : "water_intent_failed",
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

    const mealStartedAt = Date.now();
    const meal = await processMealDraft(userId, {
      source: "whatsapp",
      text: waterFoodSplit.foodText,
    });
    recordWhatsappOperationalTraceStep(trace, {
      stage: "nutrition_persistence",
      status: "success",
      durationMs: elapsedSince(mealStartedAt),
      toolNames: ["meal_create"],
    });

    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.water_and_food_multiline_detected",
      detail: "Mensagem multi-linha com hidratação e alimentos foi separada antes do processamento da refeição.",
    });

    recordWhatsappOperationalTraceStep(trace, {
      stage: "response",
      status: "success",
      durationMs: 0,
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
      const mealStartedAt = Date.now();
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.intent.food_correction_text_detected",
        detail: "Correção de texto detectada: hidratação foi substituída por alimento antes do processamento nutricional.",
      });
      const meal = await processMealDraft(userId, { source: "whatsapp", text: toText });
      recordWhatsappOperationalTraceStep(trace, {
        stage: "nutrition_persistence",
        status: "success",
        durationMs: elapsedSince(mealStartedAt),
        toolNames: ["meal_create"],
        fallbackReason: "water_to_food_correction",
      });
      recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "success", durationMs: 0 });
      return meal;
    }
  }

  const llmStartedAt = Date.now();
  const llmResult = await executeWhatsappLlmIntent(userId, {
    text,
    receivedAt,
  });
  recordWhatsappOperationalTraceStep(trace, {
    stage: "llm_router",
    status: llmResult ? "success" : "fallback",
    durationMs: elapsedSince(llmStartedAt),
    processingStrategy: llmResult?.action,
    intent: llmResult?.action,
    toolNames: llmResult?.toolNames,
    fallbackReason: llmResult ? undefined : "llm_not_handled",
    inputChars: text.length,
    outputChars: llmResult?.reply.length ?? 0,
  });
  const llmInterpreted = await logAndReturnInterpretedIntent(userId, llmResult);
  if (llmInterpreted) {
    recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "success", durationMs: 0 });
    return llmInterpreted;
  }

  const deterministicStartedAt = Date.now();
  const textIntentResult = await executeWhatsappTextIntent(userId, {
    text,
    receivedAt,
  });
  recordWhatsappOperationalTraceStep(trace, {
    stage: "deterministic_intent",
    status: textIntentResult ? "success" : "fallback",
    durationMs: elapsedSince(deterministicStartedAt),
    intent: textIntentResult?.action,
    fallbackReason: textIntentResult ? undefined : "deterministic_not_handled",
  });
  const interpreted = await logAndReturnInterpretedIntent(userId, textIntentResult);
  if (interpreted) {
    recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "success", durationMs: 0 });
    return interpreted;
  }

  const recordAdjustmentStartedAt = Date.now();
  const recordAdjustment = await executeWhatsappRecordAdjustmentIntent(userId, {
    text,
    receivedAt,
  });
  recordWhatsappOperationalTraceStep(trace, {
    stage: "record_adjustment",
    status: recordAdjustment ? "warning" : "fallback",
    durationMs: elapsedSince(recordAdjustmentStartedAt),
    intent: recordAdjustment?.action,
    fallbackReason: recordAdjustment ? "record_adjustment_requires_confirmation" : "record_adjustment_not_handled",
  });
  const recordAdjustmentInterpreted = await logAndReturnInterpretedIntent(userId, recordAdjustment);
  if (recordAdjustmentInterpreted) {
    const pendingContext = registerConversationContext(userId, text, receivedAt, recordAdjustmentInterpreted);
    if (pendingContext) {
      recordWhatsappOperationalTraceStep(trace, {
        stage: "conversation_context",
        status: "success",
        durationMs: 0,
        intent: "context_registered",
        metadata: {
          contextKind: pendingContext.kind,
          optionCount: pendingContext.options.length,
        },
      });
    }
    recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "warning", durationMs: 0 });
    return recordAdjustmentInterpreted;
  }

  const assistantStartedAt = Date.now();
  const assistant = executeWhatsAppFoodAssistantIntent(text);
  recordWhatsappOperationalTraceStep(trace, {
    stage: "food_assistant",
    status: assistant ? "success" : "fallback",
    durationMs: elapsedSince(assistantStartedAt),
    intent: assistant?.action,
    fallbackReason: assistant ? undefined : "assistant_not_handled",
  });
  if (assistant) {
    recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "success", durationMs: 0 });
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: assistant.eventType,
      detail: assistant.detail,
    });
    return assistant;
  }

  const routerStartedAt = Date.now();
  const routerDecision = routeWhatsappMessageBeforeNutrition({
    text,
    messageId: input.messageId,
    inputModality: normalizedInput.inputModality,
    pendingContextId: activeContext?.id,
    pendingContextKind: activeContext?.kind,
    actorId: userId,
    targetUserId: userId,
  });
  recordWhatsappOperationalTraceStep(trace, {
    stage: "canonical_router",
    status: routerDecision.shouldUseNutritionFallback ? "success" : "warning",
    durationMs: elapsedSince(routerStartedAt),
    schemaVersion: routerDecision.canonical.schema_version,
    processingStrategy: routerDecision.canonical.processing_strategy ?? undefined,
    intent: routerDecision.canonical.intent,
    fallbackReason: routerDecision.reason,
    metadata: {
      shouldUseNutritionFallback: routerDecision.shouldUseNutritionFallback,
      needsConfirmation: routerDecision.canonical.needs_confirmation,
      confidence: routerDecision.canonical.confidence,
    },
  });
  if (!routerDecision.shouldUseNutritionFallback && routerDecision.response) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: routerDecision.response.eventType,
      detail: routerDecision.response.detail,
    });
    recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "warning", durationMs: 0, fallbackReason: routerDecision.reason });
    return routerDecision.response;
  }

  const mealStartedAt = Date.now();
  const meal = await processMealDraft(userId, { source: "whatsapp", text });
  recordWhatsappOperationalTraceStep(trace, {
    stage: "nutrition_persistence",
    status: "success",
    durationMs: elapsedSince(mealStartedAt),
    toolNames: ["meal_create"],
  });
  recordWhatsappOperationalTraceStep(trace, { stage: "response", status: "success", durationMs: 0 });
  return meal;
}
