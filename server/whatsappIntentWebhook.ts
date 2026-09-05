import { Request, Response } from "express";
import { getCatalogCache } from "./catalogRuntime";
import {
  householdMeasureResolutionSourceLabel,
  isApproximateHouseholdMeasureResolutionKind,
} from "./householdMeasureResolution";
import { executeWhatsAppFoodAssistantIntent } from "./modules/whatsapp/foodAssistant";
import { executeWhatsappTextIntent } from "./modules/whatsapp/intentActions";
import { executeWhatsappContextualFoodReplacementIntent } from "./modules/whatsapp/contextualFoodReplacementIntent";
import { executeWhatsappDeleteIntent } from "./modules/whatsapp/deleteIntent";
import { executeWhatsappGramsAdjustmentIntent } from "./modules/whatsapp/gramsAdjustmentIntent";
import { executeWhatsappGramsIncrementIntent } from "./modules/whatsapp/gramsIncrementIntent";
import { prepareWhatsappCountableFoodRegistration } from "./modules/whatsapp/countableFoodRegistrationGate";
import { parseMealCommandFromWhatsApp } from "./modules/whatsapp/mealCommandParser";
import { resolveTextMealItemSelection } from "./modules/whatsapp/mealItemSelectionCallback";
import { executeWhatsappMealListIntent } from "./modules/whatsapp/mealListIntent";
import {
  executeWhatsappLlmIntent,
  type WhatsappLlmNutritionFallback,
} from "./modules/whatsapp/llmIntentActions";
import {
  getWhatsAppIntentLogStatus,
  type WhatsAppIntentLogStatus,
} from "./modules/whatsapp/intentResult";
import {
  buildSuspiciousWhatsAppContentReply,
  inspectWhatsAppUserContentSafety,
} from "./modules/whatsapp/promptInjectionGuard";
import { splitWhatsAppWaterAndFoodText } from "./modules/whatsapp/waterFoodText";
import {
  getDb,
  getUserIdByWhatsappPhone,
  logInferenceEvent,
  logPersistenceWarning,
} from "./db";
import { createDrizzleWhatsAppPendingOperationRepository } from "./repositories/whatsappPendingOperationRepository";
import { resolveWhatsAppPrecedenceGate } from "./modules/whatsapp/messageRouter";
import { evaluateWhatsappIntentRoute } from "./modules/whatsapp/intentRouter";
import {
  collapseWhitespace,
  extractWhatsAppWebhookMessages,
  getExtractedWhatsAppMessageKey,
  getWhatsAppInteractiveReplyId,
  isWhatsAppMessageForConfiguredChannel,
  resolveWhatsAppMessageOccurredAt,
  stripDiacritics,
  type ExtractedWhatsAppWebhookMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import type { WhatsAppLogicalReply } from "./modules/whatsapp/replyContract";
import { sendWhatsAppLogicalDomainReply } from "./modules/whatsapp/logicalReplyDelivery";
import { setWhatsAppDeferredLogicalReply } from "./modules/whatsapp/deferredLogicalReply";
import {
  buildWhatsappPeriodReportClarificationListReply,
  PENDING_PERIOD_REPORT_TYPE,
} from "./modules/whatsapp/periodReportClarification";
import type { DomainLinkInput } from "./repositories/whatsappConversationRepository";
import { joinUnitWords } from "./modules/whatsapp/quantityUnitVocabulary";
import { buildWhatsAppCanonicalWeightReply } from "./modules/whatsapp/domainReplyFormatters";
import { ensureWhatsAppWeightEntry } from "./modules/whatsapp/weightIdempotency";
import { getWhatsAppWeightVariation } from "./modules/whatsapp/userMeasurementReplyContext";
import { resolveWhatsAppOperationTimeZone } from "./modules/whatsapp/timeZoneContext";
import { handleWhatsAppWebhookWithAnnotatedImages } from "./whatsappAnnotatedImageWebhook";
import { createMessageDeduplicationCache } from "./modules/whatsapp/messageDeduplicationCache";
import {
  recordConversationTurn,
  __resetConversationHistoryForTests,
} from "./modules/whatsapp/conversationHistory";
import {
  beginInboundMessage,
  markMessageProcessed,
  recordDomainLink,
  wasMessageAlreadyProcessed,
  type MessageLifecycleHandle,
} from "./modules/whatsapp/messageLifecycle";

type TextIntentResult =
  | NonNullable<Awaited<ReturnType<typeof executeWhatsappTextIntent>>>
  | NonNullable<Awaited<ReturnType<typeof executeWhatsappDeleteIntent>>>
  | Exclude<
      NonNullable<Awaited<ReturnType<typeof executeWhatsappLlmIntent>>>,
      WhatsappLlmNutritionFallback
    >
  | NonNullable<ReturnType<typeof executeWhatsAppFoodAssistantIntent>>;
type TextIntentHandlingResult =
  | boolean
  | {
      passthroughText: string;
      intentHint?:
        | import("./modules/whatsapp/llmIntentActions").WhatsappLlmNutritionFallback["intentHint"]
        | null;
    };
type ReadyCountableFoodRegistration = Extract<
  Awaited<ReturnType<typeof prepareWhatsappCountableFoodRegistration>>,
  { kind: "ready" }
>;
const textIntentMessageDeduplicationCache = createMessageDeduplicationCache();
const TEXT_INTENT_CONTEXT_TTL_MS = 10 * 60 * 1000;
const PERIOD_REPORT_PENDING_ORIGIN = "whatsappIntentWebhook";
const pendingOperationRepository =
  createDrizzleWhatsAppPendingOperationRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });
const SIMPLE_FOOD_QUANTITY_UNIT_PATTERN = joinUnitWords([
  "gramas",
  "quilos",
  "miligramas",
  "mililitrosCompact",
  "litros",
  "unidades",
  "fatias",
  "pedacos",
  "xicarasPlain",
  "copos",
  "colheresGeneric",
  "doses",
  "scoops",
  "longNeck",
  "latas",
  "garrafas",
  "porcoesPlain",
]);
const MIN_WEIGHT_LOG_KG = 25;
const MAX_WEIGHT_LOG_KG = 350;
const UNKNOWN_FOOD_REPLY = [
  "Não encontrei esse alimento no catálogo ainda.",
  "Me envie com mais detalhes, como marca, porção ou uma foto do rótulo, para eu conseguir registrar corretamente.",
  "Exemplo: 1 unidade de bisnaguinha Panco ou 30 g de queijo.",
].join("\n\n");

function getTextBody(message: WhatsAppWebhookMessage) {
  return message.text?.body?.trim() || "";
}

function canInterpretTextIntent(message: WhatsAppWebhookMessage) {
  return Boolean(
    (getTextBody(message) || getWhatsAppInteractiveReplyId(message)) &&
      !message.image?.id &&
      !message.audio?.id
  );
}

function normalizeText(value: string) {
  return collapseWhitespace(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
  );
}

function looksLikeTonicWaterFood(text: string) {
  const normalized = normalizeText(text);
  return /\bagua\s+tonicas?\b/.test(normalized);
}

// Comandos de adição de alimento ("adicionar 100 g de feijão no almoço") compartilham
// verbos com incrementos de gramas; eles devem seguir para o fluxo de adição em
// executeWhatsappTextIntent em vez de serem tratados como incremento de item existente.
function isFoodAdditionCommand(text: string, receivedAt: Date) {
  const parsed = parseMealCommandFromWhatsApp(text, {
    referenceDate: receivedAt,
  });
  return (
    parsed.intent === "add_items_to_meal" &&
    Boolean(parsed.mealType) &&
    parsed.items.length > 0
  );
}

function normalizeTextPreservingQuantities(value: string) {
  return stripDiacritics(value).toLowerCase();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    value
  );
}

function buildCountableResolutionPrefixBlock(
  resolutions: ReadyCountableFoodRegistration["resolutions"]
) {
  if (!resolutions.length) return null;
  const lines = resolutions.map(({ request, resolution }) => {
    const requested = `${formatNumber(request.count)} ${request.requestedUnit}`;
    const grams = formatNumber(resolution.grams);
    const approximate = isApproximateHouseholdMeasureResolutionKind(resolution.kind);
    const sourceLabel = householdMeasureResolutionSourceLabel(resolution.kind);
    return `• ${request.foodName}: ${requested} → ${approximate ? "aprox. " : ""}${grams} g (${sourceLabel})`;
  });
  return ["Medidas usadas no cálculo:", ...lines].join("\n");
}

function parseWeightKg(text: string) {
  const normalized = normalizeTextPreservingQuantities(text);
  const weightFirstMatch = normalized.match(
    /\b(?:peso atual|peso|pesei|pesando)\b[^\d]*(\d{2,3}(?:[,.]\d{1,2})?)\b/
  );
  if (weightFirstMatch) {
    return Number(weightFirstMatch[1].replace(",", "."));
  }

  const numberBeforeWeightMatch = normalized.match(
    /\b(\d{2,3}(?:[,.]\d{1,2})?)\s*(?:de\s*)?(?:peso atual|peso|pesei|pesando)\b/
  );
  if (numberBeforeWeightMatch) {
    return Number(numberBeforeWeightMatch[1].replace(",", "."));
  }

  const kgMatch = normalized.match(
    /\b(\d{2,3}(?:[,.]\d{1,2})?)\s*(?:kg|kgs|quilo|quilos)\b/
  );
  if (kgMatch) {
    return Number(kgMatch[1].replace(",", "."));
  }

  return null;
}

function isValidWeightKg(weightKg: number | null) {
  return Boolean(
    weightKg && weightKg >= MIN_WEIGHT_LOG_KG && weightKg <= MAX_WEIGHT_LOG_KG
  );
}

function detectWeightLogFromText(text: string) {
  const normalized = normalizeText(text);
  const mentionsWeightWord = /\b(peso|pesei|pesando)\b/.test(normalized);
  const mentionsWeightUnit = /\b(kg|kgs|quilo|quilos)\b/.test(normalized);
  if (!mentionsWeightWord && !mentionsWeightUnit) {
    return null;
  }

  const weightKg = parseWeightKg(text);
  if (isValidWeightKg(weightKg)) {
    return { kind: "weight" as const, weightKg: weightKg! };
  }

  return mentionsWeightWord ? { kind: "clarification" as const } : null;
}

function hasExplicitFoodQuantity(text: string) {
  const normalized = normalizeTextPreservingQuantities(text);
  return new RegExp(
    `\\b\\d+(?:[,.]\\d+)?\\s*(?:${SIMPLE_FOOD_QUANTITY_UNIT_PATTERN})\\b`,
    "i"
  ).test(normalized);
}

function extractSimpleFoodCandidate(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  if (
    /[,;+\n]/.test(text) ||
    /\b(e|com)\b/.test(normalized) ||
    /\b(resumo|relatorio|balanco|sugestao|agua|peso|mudar|alterar|trocar|corrigir|reduzir|aumentar|adicionar|registrar|registra|registre|inclua|remover|tirar|excluir|exclua|apagar|apague|deletar|delete|almocei|jantei|comi|lanchei|refeicao)\b/.test(
      normalized
    )
  )
    return null;

  const candidate = normalized
    .replace(/^\d+(?:[,.]\d+)?\s*/, "")
    .replace(
      /^(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+/,
      ""
    )
    .replace(
      /^(?:unidades?|unid|und|porcoes?|porcao|fatias?|pedacos?|xicaras?|copos?|colheres?)\s+(?:de\s+)?/,
      ""
    )
    .trim();

  if (
    !candidate ||
    candidate.split(/\s+/).length < 2 ||
    candidate.split(/\s+/).length > 5
  )
    return null;
  return candidate;
}

function catalogContainsFood(candidate: string) {
  const normalizedCandidate = normalizeText(candidate);
  return getCatalogCache().some(item => {
    const names = [item.name, ...item.aliases]
      .map(normalizeText)
      .filter(Boolean);
    return names.some(
      name =>
        name === normalizedCandidate ||
        normalizedCandidate.includes(name) ||
        name.includes(normalizedCandidate)
    );
  });
}

function buildUnknownFoodReply(text: string) {
  if (hasExplicitFoodQuantity(text)) return null;

  const candidate = extractSimpleFoodCandidate(text);
  if (!candidate || catalogContainsFood(candidate)) return null;
  return UNKNOWN_FOOD_REPLY;
}

function isBareDailySummaryRequest(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized === "resuma" ||
    normalized === "resumo" ||
    normalized === "relatorio" ||
    normalized === "balanco"
  );
}

function isDefinitelyFoodRegistration(normalized: string) {
  // Verbos no passado ou imperativos de registro explícito — claramente um consumo
  if (
    /\b(almocei|jantei|comi|lanchei|ceei|tomei|bebi|registrei)\b/.test(
      normalized
    )
  )
    return true;
  // Imperativo de registro com alimento mencionado
  if (
    /\b(registrar|registre|registra|adicionar|adicione|adiciona|inclua|incluir|lance|lancar)\b/.test(
      normalized
    )
  )
    return true;
  return false;
}

function shouldTryContextualLlmIntent(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  // Mensagens com quantidade explícita de alimento são quase sempre registros — deixar para o pipeline nutricional
  if (hasExplicitFoodQuantity(text)) return false;

  // Registro explícito e inequívoco — não precisa do classificador
  if (isDefinitelyFoodRegistration(normalized)) return false;

  // Qualquer mensagem que não seja claramente um registro deve passar pelo LLM classificador.
  // Isso inclui perguntas nutricionais ("quanto tem de proteína no frango?"),
  // pedidos de sugestão, consultas, comandos de gestão e textos ambíguos.
  return true;
}

function looksLikeProfessionalAccessDecision(text: string) {
  const normalized = normalizeText(text);
  return /\b(autorizar|autorizo|autorizado|aprovar|aprovo|permitir|permito|negar|nego|recusar|recuso|nao autorizo)\b/.test(
    normalized
  );
}

async function buildMealAdditionAwareReply(
  _userId: number,
  result: TextIntentResult
) {
  return result.reply;
}

function wasTextIntentMessageAlreadyHandled(messageId?: string) {
  return textIntentMessageDeduplicationCache.wasAlreadyHandled(messageId);
}

function markTextIntentMessageHandled(messageId?: string) {
  textIntentMessageDeduplicationCache.markHandled(messageId);
}

async function getPendingTextIntentContext(userId: number) {
  const pending =
    await pendingOperationRepository.getActivePendingOperation(userId);
  if (!pending || pending.type !== PENDING_PERIOD_REPORT_TYPE) return null;
  return { kind: "period_report" as const, id: pending.id };
}

async function clearPendingTextIntentContext(userId: number) {
  const pending =
    await pendingOperationRepository.getActivePendingOperation(userId);
  if (pending && pending.type === PENDING_PERIOD_REPORT_TYPE) {
    await pendingOperationRepository.cancelPendingOperation(pending.id);
  }
}

async function rememberPendingTextIntentContext(
  userId: number,
  result: TextIntentResult
) {
  if (
    result.action === "clarification_needed" &&
    result.detail === "Pedido de relatório sem período explícito."
  ) {
    const pending = await pendingOperationRepository.createPendingOperation({
      userId,
      type: PENDING_PERIOD_REPORT_TYPE,
      origin: PERIOD_REPORT_PENDING_ORIGIN,
      ttlMs: TEXT_INTENT_CONTEXT_TTL_MS,
      target: { kind: "period_report" },
    });
    // Pergunta com escolhas objetivas usa lista interativa (#782); o fallback
    // textual ("ontem", "semana"...) continua resolvendo a mesma pendência.
    return pending?.id
      ? buildWhatsappPeriodReportClarificationListReply(
          pending.id,
          result.reply
        )
      : null;
  }
  await clearPendingTextIntentContext(userId);
  return null;
}

export function __resetWhatsAppTextIntentContextForTests() {
  textIntentMessageDeduplicationCache.clear();
  __resetConversationHistoryForTests();
}

async function sendAndLogTextReply(input: {
  userId: number;
  sourcePhone: string;
  userMessage: string;
  reply: string;
  eventType: string;
  detail: string;
  status: WhatsAppIntentLogStatus;
  mealId?: number | null;
  occurredAtMs?: number;
  lifecycleHandle?: MessageLifecycleHandle;
  interactiveReply?: WhatsAppLogicalReply;
}) {
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: input.status,
    eventType: input.eventType,
    detail: input.detail,
  });

  const delivery = await sendWhatsAppLogicalDomainReply({
    to: input.sourcePhone,
    userId: input.userId,
    replyText: input.reply,
    mealId: input.mealId,
    logicalReply: input.interactiveReply,
    lifecycleHandle: input.lifecycleHandle,
  });
  const replyOk = delivery.result.primaryOk;
  if (!delivery.result.ok) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: replyOk ? "warning" : "error",
      eventType: "whatsapp.reply_failed",
      detail: `Falha ao enviar resposta lógica para ${input.sourcePhone}.`,
    });
  }

  recordConversationTurn(
    input.userId,
    input.userMessage,
    replyOk ? input.reply : null,
    input.occurredAtMs ?? Date.now()
  );
  if (input.mealId)
    await recordDomainLink(input.lifecycleHandle ?? null, {
      mealId: input.mealId,
    });
  await markMessageProcessed(input.lifecycleHandle ?? null);
}

function extractMealId(data: Record<string, unknown> | undefined) {
  return typeof data?.mealId === "number" ? data.mealId : null;
}

function extractEditableMealId(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const candidate = result as { action?: unknown; data?: unknown };
  if (candidate.action === "meal_deleted") return null;
  return extractMealId(
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Record<string, unknown>)
      : undefined
  );
}

async function tryHandleTextIntent(
  req: Request,
  message: ExtractedWhatsAppWebhookMessage
): Promise<TextIntentHandlingResult> {
  const sourcePhone = message.from || "unknown";
  if (
    !isWhatsAppMessageForConfiguredChannel(message) ||
    !canInterpretTextIntent(message)
  )
    return false;
  if (wasTextIntentMessageAlreadyHandled(message.id)) return true;

  const userId = await getUserIdByWhatsappPhone(sourcePhone);
  if (!userId) return false;

  const text = getTextBody(message);
  const occurredAt = resolveWhatsAppMessageOccurredAt(message);
  const occurredAtMs = occurredAt.getTime();
  const lifecycleHandle = await beginInboundMessage({
    userId,
    whatsappConnectionId: null,
    phoneNumber: sourcePhone,
    externalMessageId: message.id,
    contentType: "text",
    text,
    occurredAt,
    allowRawContentStorage: true,
  });

  // Idempotência de domínio (issue #767): se esta mensagem (mesmo externalMessageId) já
  // tinha um registro de domínio vinculado, é uma reentrega — não repete a ação nem gera
  // nova resposta funcional, só confirma o recebimento.
  if (await wasMessageAlreadyProcessed(lifecycleHandle)) {
    markTextIntentMessageHandled(message.id);
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.idempotency.duplicate_detected",
      detail: JSON.stringify({ source: "db_unique_constraint" }),
    });
    await markMessageProcessed(lifecycleHandle);
    return true;
  }

  try {
    return await handleTextIntentAfterLifecycleBegin(userId);
  } catch (error) {
    await markMessageProcessed(lifecycleHandle);
    throw error;
  }

  async function handleTextIntentAfterLifecycleBegin(
    userId: number
  ): Promise<TextIntentHandlingResult> {
    const timeZoneResolution = await resolveWhatsAppOperationTimeZone(userId);
    const userTimezone = timeZoneResolution.timeZone;
    const safety = inspectWhatsAppUserContentSafety(text, "text");
    if (!safety.safe) {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: buildSuspiciousWhatsAppContentReply(),
        eventType: "whatsapp.security_guard_blocked",
        detail: `Conteudo bloqueado por seguranca antes do roteamento textual: ${safety.categories.join(", ") || "security_guard"}.`,
        status: "warning",
        occurredAtMs,
        lifecycleHandle,
      });
      return true;
    }

    // Precedência obrigatória (issue #766): comando explícito `/`, pendência operacional
    // ativa e callback de botão/lista (issue #782) são resolvidos em um único ponto
    // compartilhado, antes de qualquer classificação de intenção (exclusão, ajuste,
    // substituição, LLM etc).
    const interactiveReplyId = getWhatsAppInteractiveReplyId(message);
    const precedenceGate = await resolveWhatsAppPrecedenceGate({
      userId,
      text,
      receivedAt: occurredAt,
      userTimezone,
      interactiveReplyId,
      sourcePhone,
      messageId: message.id,
    });
    if (precedenceGate.step !== "continue_pipeline") {
      markTextIntentMessageHandled(message.id);
      const preservePendingAfterReplay =
        precedenceGate.result.eventType === "whatsapp.interaction.pending_represented";
      if (!preservePendingAfterReplay) {
        await clearPendingTextIntentContext(userId);
      }
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: precedenceGate.result.reply,
        eventType: precedenceGate.result.eventType,
        detail: precedenceGate.result.detail,
        status:
          "action" in precedenceGate.result &&
          precedenceGate.result.action === "clarification_needed"
            ? "warning"
            : "success",
        mealId: extractEditableMealId(precedenceGate.result),
        occurredAtMs,
        lifecycleHandle,
        interactiveReply:
          "interactiveReply" in precedenceGate.result
            ? precedenceGate.result.interactiveReply
            : undefined,
      });
      return true;
    }

    const { tryAssociateProfessionalWhatsappResponse } = await import(
      "./modules/professionals/messageService"
    );
    const professionalResponse = await tryAssociateProfessionalWhatsappResponse(
      {
        patientUserId: userId,
        text,
        externalMessageId:
          message.id ?? getExtractedWhatsAppMessageKey(message),
        receivedAt: occurredAt,
      }
    );
    if (professionalResponse) {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: professionalResponse.reply,
        eventType: professionalResponse.eventType,
        detail: professionalResponse.detail,
        status: professionalResponse.eventType.endsWith("received")
          ? "success"
          : "warning",
        occurredAtMs,
        lifecycleHandle,
      });
      return true;
    }

    if (looksLikeTonicWaterFood(text)) {
      return false;
    }

    if (looksLikeProfessionalAccessDecision(text)) {
      const { processProfessionalAccessWhatsappResponse } = await import(
        "./modules/professionals/service"
      );
      const professionalAccessResponse =
        await processProfessionalAccessWhatsappResponse(userId, text);
      if (professionalAccessResponse) {
        markTextIntentMessageHandled(message.id);
        await clearPendingTextIntentContext(userId);
        await sendAndLogTextReply({
          userId,
          sourcePhone,
          userMessage: text,
          reply: professionalAccessResponse.reply,
          eventType: professionalAccessResponse.eventType,
          detail: professionalAccessResponse.detail,
          status:
            professionalAccessResponse.action ===
            "professional_access_decision_ambiguous"
              ? "warning"
              : "success",
          occurredAtMs,
        });
        return true;
      }
    }

    const weightLog = detectWeightLogFromText(text);
    if (weightLog?.kind === "clarification") {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply:
          "Entendi que você quer registrar peso, mas preciso do valor em kg. Exemplo: peso 80,5 kg.",
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido de peso sem valor explícito válido.",
        status: "warning",
        occurredAtMs,
        lifecycleHandle,
      });
      return true;
    }

    if (weightLog?.kind === "weight") {
      const timeZone = userTimezone;
      const { variationKg } = await getWhatsAppWeightVariation(
        userId,
        occurredAt,
        weightLog.weightKg
      );
      const persistedWeight = await ensureWhatsAppWeightEntry(userId, {
        weightKg: weightLog.weightKg,
        measuredAt: occurredAt,
        notes: "Peso atualizado pelo WhatsApp.",
      });
      if (persistedWeight.entry.id > 0) {
        await recordDomainLink(lifecycleHandle, {
          weightEntryId: persistedWeight.entry.id,
        });
      }

      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: buildWhatsAppCanonicalWeightReply({
          weightKg: weightLog.weightKg,
          variationKg,
          occurredAtLabel: occurredAt.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone,
          }),
        }),
        eventType: "whatsapp.intent.weight_logged",
        detail: `Peso de ${formatNumber(weightLog.weightKg)} kg registrado pelo WhatsApp textual sem passar pelo fluxo de alimento.`,
        status: "success",
        occurredAtMs,
        lifecycleHandle,
      });
      return true;
    }

    const mixedWaterFood = splitWhatsAppWaterAndFoodText(text);
    if (mixedWaterFood) {
      const waterResults: TextIntentResult[] = [];
      for (const waterLine of mixedWaterFood.waterLines) {
        const result = await executeWhatsappTextIntent(userId, {
          text: waterLine.text,
          receivedAt: occurredAt,
          userTimezone,
        });
        if (!result || result.action !== "water_logged") {
          await sendAndLogTextReply({
            userId,
            sourcePhone,
            userMessage: text,
            reply: `Não consegui registrar a hidratação em "${waterLine.text}". Reenvie a água e os alimentos em mensagens separadas para evitar registro parcial.`,
            eventType: "whatsapp.intent.water_food_multiline_failed",
            detail:
              "Falha ao registrar hidratação em mensagem multi-linha com alimentos.",
            status: "warning",
            occurredAtMs,
            lifecycleHandle,
          });
          markTextIntentMessageHandled(message.id);
          return true;
        }
        waterResults.push(result);
      }

      const countableGate = await prepareWhatsappCountableFoodRegistration({
        userId,
        text: mixedWaterFood.foodText,
        originalText: text,
        inboundMessageId: message.id ?? null,
        receivedAt: occurredAt,
        userTimezone,
      });
      const waterPrefixBlocks = waterResults.map(result => result.reply);
      const domainLinks: DomainLinkInput[] = waterResults
        .map(result =>
          typeof result.data?.waterLogId === "number"
            ? { waterLogId: result.data.waterLogId }
            : null
        )
        .filter((link): link is { waterLogId: number } => Boolean(link));

      if (countableGate.kind === "clarification") {
        for (const domainLink of domainLinks) {
          await recordDomainLink(lifecycleHandle, domainLink);
        }
        markTextIntentMessageHandled(message.id);
        await clearPendingTextIntentContext(userId);
        await sendAndLogTextReply({
          userId,
          sourcePhone,
          userMessage: text,
          reply: [...waterPrefixBlocks, countableGate.result.reply].join("\n\n"),
          eventType: countableGate.result.eventType,
          detail: countableGate.result.detail,
          status: "warning",
          occurredAtMs,
          lifecycleHandle,
          interactiveReply: countableGate.result.interactiveReply,
        });
        return true;
      }

      // Água e alimento na mesma entrada formam uma única resposta funcional
      // lógica (#785): os blocos canônicos de água entram como prefixo da
      // resposta final do fluxo nutricional, sem outbound próprio. A resolução
      // de medidas contáveis ocorre antes do passthrough para não perder gramas.
      const countableResolutionPrefix = buildCountableResolutionPrefixBlock(
        countableGate.resolutions
      );
      const prefixBlocks = [
        ...waterPrefixBlocks,
        ...(countableResolutionPrefix ? [countableResolutionPrefix] : []),
      ];
      setWhatsAppDeferredLogicalReply(req, message.id, {
        prefixBlocks,
        domainLinks,
      });
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.intent.water_food_multiline_split",
        detail:
          "Hidratação registrada e composta como prefixo da resposta nutricional da mesma mensagem.",
      });
      return { passthroughText: countableGate.registrationText };
    }

    const pendingContext = await getPendingTextIntentContext(userId);
    const textForIntent =
      pendingContext?.kind === "period_report"
        ? `Resumo ${text}`
        : isBareDailySummaryRequest(text)
          ? "Resumo hoje"
          : text;

    const mealItemSelectionResult = await resolveTextMealItemSelection(
      userId,
      textForIntent
    );
    if (mealItemSelectionResult) {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: mealItemSelectionResult.reply,
        eventType: mealItemSelectionResult.eventType,
        detail: mealItemSelectionResult.detail,
        status:
          mealItemSelectionResult.action === "clarification_needed"
            ? "warning"
            : "success",
        mealId: extractMealId(mealItemSelectionResult.data),
        occurredAtMs,
        lifecycleHandle,
        interactiveReply: mealItemSelectionResult.interactiveReply,
      });
      return true;
    }

    const deleteIntentResult = await executeWhatsappDeleteIntent(userId, {
      text: textForIntent,
      timeZone: userTimezone,
    });
    if (deleteIntentResult) {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: deleteIntentResult.reply,
        eventType: deleteIntentResult.eventType,
        detail: deleteIntentResult.detail,
        status: "warning",
        occurredAtMs,
        lifecycleHandle,
        interactiveReply: deleteIntentResult.interactiveReply,
      });
      return true;
    }

    const mealListResult = await executeWhatsappMealListIntent(userId, {
      text: textForIntent,
      receivedAt: occurredAt,
    });
    if (mealListResult) {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: mealListResult.reply,
        eventType: mealListResult.eventType,
        detail: mealListResult.detail,
        status:
          mealListResult.action === "clarification_needed"
            ? "warning"
            : "success",
        mealId: extractMealId(mealListResult.data),
        occurredAtMs,
        lifecycleHandle,
      });
      return true;
    }

    const contextualReplacementResult =
      await executeWhatsappContextualFoodReplacementIntent(userId, {
        text: textForIntent,
        receivedAt: occurredAt,
      });
    if (contextualReplacementResult) {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: contextualReplacementResult.reply,
        eventType: contextualReplacementResult.eventType,
        detail: contextualReplacementResult.detail,
        status:
          contextualReplacementResult.action === "clarification_needed"
            ? "warning"
            : "success",
        mealId: extractMealId(contextualReplacementResult.data),
        occurredAtMs,
        lifecycleHandle,
        interactiveReply: contextualReplacementResult.interactiveReply,
      });
      return true;
    }

    const gramsAdjustmentResult = await executeWhatsappGramsAdjustmentIntent(
      userId,
      { text: textForIntent, receivedAt: occurredAt }
    );
    if (gramsAdjustmentResult) {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: gramsAdjustmentResult.reply,
        eventType: gramsAdjustmentResult.eventType,
        detail: gramsAdjustmentResult.detail,
        status:
          gramsAdjustmentResult.action === "clarification_needed"
            ? "warning"
            : "success",
        mealId: extractMealId(gramsAdjustmentResult.data),
        occurredAtMs,
        lifecycleHandle,
        interactiveReply: gramsAdjustmentResult.interactiveReply,
      });
      return true;
    }

    const canonicalFoodAddition = isFoodAdditionCommand(
      textForIntent,
      occurredAt
    );
    const gramsIncrementResult = canonicalFoodAddition
      ? null
      : await executeWhatsappGramsIncrementIntent(userId, {
          text: textForIntent,
          receivedAt: occurredAt,
          userTimezone,
          messageId: message.id ?? null,
        });
    if (gramsIncrementResult) {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: gramsIncrementResult.reply,
        eventType: gramsIncrementResult.eventType,
        detail: gramsIncrementResult.detail,
        status:
          gramsIncrementResult.action === "clarification_needed"
            ? "warning"
            : "success",
        mealId: extractMealId(gramsIncrementResult.data),
        occurredAtMs,
        lifecycleHandle,
        interactiveReply: gramsIncrementResult.interactiveReply,
      });
      return true;
    }

    // O wrapper textual é o dono do passthrough para o pipeline nutricional.
    // Resolve medidas contáveis aqui, depois dos handlers de maior precedência,
    // e entrega o texto já reescrito ao executeWhatsappTextIntent. Assim o
    // preflight interno dos consumidores diretos continua existindo, mas não
    // reexecuta a resolução neste caminho porque passa a receber gramas.
    const canonicalRoute = evaluateWhatsappIntentRoute({ text: textForIntent });
    const countableGate = canonicalFoodAddition || canonicalRoute.action === "safe_non_food_response"
      ? null
      : await prepareWhatsappCountableFoodRegistration({
          userId,
          text: textForIntent,
          originalText: text,
          inboundMessageId: message.id ?? null,
          receivedAt: occurredAt,
          userTimezone,
        });
    if (countableGate?.kind === "clarification") {
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: countableGate.result.reply,
        eventType: countableGate.result.eventType,
        detail: countableGate.result.detail,
        status: "warning",
        occurredAtMs,
        lifecycleHandle,
        interactiveReply: countableGate.result.interactiveReply,
      });
      return true;
    }
    const textForNutrition =
      countableGate?.kind === "ready"
        ? countableGate.registrationText
        : textForIntent;
    const hasCountableResolution =
      countableGate?.kind === "ready" && countableGate.resolutions.length > 0;
    const countableResolutionPrefix =
      countableGate?.kind === "ready"
        ? buildCountableResolutionPrefixBlock(countableGate.resolutions)
        : null;

    let nutritionFallback: WhatsappLlmNutritionFallback | null = null;
    let result: TextIntentResult | null = await executeWhatsappTextIntent(
      userId,
      { text: textForNutrition, receivedAt: occurredAt, userTimezone }
    );

    // Uma resolução contável positiva já estabelece a intenção alimentar.
    // O classificador contextual não pode rebaixar essa decisão determinística
    // para ambiguidade; o texto canônico segue direto ao pipeline nutricional.
    if (!result && hasCountableResolution && countableGate?.kind === "ready") {
      if (countableResolutionPrefix) {
        setWhatsAppDeferredLogicalReply(req, message.id, {
          prefixBlocks: [countableResolutionPrefix],
          domainLinks: [],
        });
      }
      return { passthroughText: countableGate.registrationText };
    }

    if (!result && shouldTryContextualLlmIntent(textForIntent)) {
      const llmResult = await executeWhatsappLlmIntent(userId, {
        text: textForIntent,
        receivedAt: occurredAt,
      });
      if (llmResult && "handled" in llmResult && !llmResult.handled) {
        // Classificador decidiu encaminhar ao pipeline nutricional com contexto de intenção
        nutritionFallback = llmResult as WhatsappLlmNutritionFallback;
      } else {
        result = llmResult as TextIntentResult | null;
      }
    }
    result ??= executeWhatsAppFoodAssistantIntent(text);

    if (!result) {
      // Se o classificador gerou um intentHint (fallback nutricional com contexto),
      // encaminha ao pipeline de imagem/nutricional com o hint para coordenar a extração.
      // Reutiliza o mesmo preflight já executado acima; só executa aqui quando o
      // caminho canônico de adição foi preservado e ainda assim houve fallback.
      if (nutritionFallback) {
        const fallbackGate =
          countableGate ??
          (await prepareWhatsappCountableFoodRegistration({
            userId,
            text: textForIntent,
            originalText: text,
            inboundMessageId: message.id ?? null,
            receivedAt: occurredAt,
            userTimezone,
          }));
        if (fallbackGate.kind === "clarification") {
          markTextIntentMessageHandled(message.id);
          await clearPendingTextIntentContext(userId);
          await sendAndLogTextReply({
            userId,
            sourcePhone,
            userMessage: text,
            reply: fallbackGate.result.reply,
            eventType: fallbackGate.result.eventType,
            detail: fallbackGate.result.detail,
            status: "warning",
            occurredAtMs,
            lifecycleHandle,
            interactiveReply: fallbackGate.result.interactiveReply,
          });
          return true;
        }
        const fallbackResolutionPrefix = buildCountableResolutionPrefixBlock(
          fallbackGate.resolutions
        );
        if (fallbackResolutionPrefix) {
          setWhatsAppDeferredLogicalReply(req, message.id, {
            prefixBlocks: [fallbackResolutionPrefix],
            domainLinks: [],
          });
        }
        return {
          passthroughText: fallbackGate.registrationText,
          intentHint: nutritionFallback.intentHint,
        };
      }

      const unknownFoodReply = buildUnknownFoodReply(text);
      if (!unknownFoodReply) return false;
      markTextIntentMessageHandled(message.id);
      await clearPendingTextIntentContext(userId);
      await sendAndLogTextReply({
        userId,
        sourcePhone,
        userMessage: text,
        reply: unknownFoodReply,
        eventType: "whatsapp.intent.food_not_found",
        detail:
          "Alimento simples informado por texto não encontrado no catálogo antes da inferência nutricional.",
        status: "warning",
        occurredAtMs,
        lifecycleHandle,
      });
      return true;
    }

    markTextIntentMessageHandled(message.id);
    const pendingInteractiveReply = await rememberPendingTextIntentContext(
      userId,
      result
    );
    await sendAndLogTextReply({
      userId,
      sourcePhone,
      userMessage: text,
      reply: await buildMealAdditionAwareReply(userId, result),
      eventType: result.eventType,
      detail: result.detail,
      status: getWhatsAppIntentLogStatus(result.action),
      mealId: extractMealId(result.data),
      occurredAtMs,
      lifecycleHandle,
      interactiveReply:
        pendingInteractiveReply ??
        ("interactiveReply" in result ? result.interactiveReply : undefined),
    });
    return true;
  }
}

function clonePayloadWithoutHandledMessages(
  payload: any,
  handledMessageKeys: Set<string>,
  textOverrides = new Map<string, string>()
) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];
  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      if (!Array.isArray(entry?.changes)) return entry;
      const changes = entry.changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages)
            ? change.value.messages
            : [];
          const pendingMessages = messages
            .map((message: WhatsAppWebhookMessage, messageIndex: number) => {
              const key = `${entryIndex}:${changeIndex}:${messageIndex}`;
              if (handledMessageKeys.has(key)) return null;

              const overrideText = textOverrides.get(key);
              if (overrideText && message.text?.body) {
                return {
                  ...message,
                  text: {
                    ...message.text,
                    body: overrideText,
                  },
                };
              }

              return message;
            })
            .filter(Boolean);
          return {
            ...change,
            value: { ...change.value, messages: pendingMessages },
          };
        })
        .filter(
          (change: any) =>
            Array.isArray(change?.value?.messages) &&
            change.value.messages.length > 0
        );
      return { ...entry, changes };
    })
    .filter(
      (entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0
    );
  return cloned;
}

export async function handleWhatsAppWebhookWithTextIntent(
  req: Request,
  res: Response
) {
  const messages = extractWhatsAppWebhookMessages(req.body);
  if (!messages.length)
    return handleWhatsAppWebhookWithAnnotatedImages(req, res);

  const handledMessageKeys = new Set<string>();
  const textOverrides = new Map<string, string>();
  const intentHints = new Map<
    string,
    import("./modules/whatsapp/llmIntentActions").WhatsappLlmNutritionFallback["intentHint"]
  >();
  for (const message of messages) {
    const handled = await tryHandleTextIntent(req, message);
    const key = getExtractedWhatsAppMessageKey(message);
    if (handled === true) {
      handledMessageKeys.add(key);
    } else if (handled && typeof handled === "object") {
      textOverrides.set(key, handled.passthroughText);
      if (handled.intentHint) {
        intentHints.set(key, handled.intentHint);
      }
    }
  }

  if (!handledMessageKeys.size && !textOverrides.size)
    return handleWhatsAppWebhookWithAnnotatedImages(req, res);

  const remainingPayload = clonePayloadWithoutHandledMessages(
    req.body,
    handledMessageKeys,
    textOverrides
  );
  if (
    !Array.isArray(remainingPayload?.entry) ||
    remainingPayload.entry.length === 0
  ) {
    return res.status(200).json({ ok: true, processed: messages.length });
  }

  req.body = remainingPayload;
  // Propaga os intentHints ao pipeline nutricional via campo auxiliar no request
  if (intentHints.size) {
    (req as any).__intentHints = intentHints;
  }
  return handleWhatsAppWebhookWithAnnotatedImages(req, res);
}
