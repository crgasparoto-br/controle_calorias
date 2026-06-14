import {
  buildCanonicalIntentOutputFromRuntime,
  WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION,
  whatsappCanonicalIntentOutputSchema,
  type WhatsappCanonicalIntentName,
  type WhatsappCanonicalIntentOutput,
  type WhatsappInputModality,
} from "./canonicalIntentSchema";
import { classifyWhatsappMessageDeterministically } from "./intentInterpreter";
import type { WhatsappInterpretedIntent } from "./intentSchema";

export type WhatsappPreNutritionRouterDecision = {
  canonical: WhatsappCanonicalIntentOutput;
  shouldUseNutritionFallback: boolean;
  response: WhatsappRouterSafeResponse | null;
  reason: string;
};

export type WhatsappRouterSafeResponse = {
  handled: true;
  action: "router_clarification_needed" | "router_contextual_response" | "router_calculation_detected";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

type RouteInput = {
  text: string;
  messageId?: string | null;
  inputModality?: WhatsappInputModality;
  pendingContextId?: string | null;
  pendingContextKind?: string | null;
  actorId?: string | number | null;
  targetUserId?: string | number | null;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+\-*/,.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: string) {
  return Number(value.replace(",", "."));
}

function buildBaseCanonical(input: RouteInput & {
  intent: WhatsappCanonicalIntentName;
  confidence: number;
  needsConfirmation: boolean;
  contextRequired?: boolean;
  requestedOutputType?: WhatsappCanonicalIntentOutput["requested_output_type"];
  ambiguityReason?: string | null;
  warnings?: string[];
  calculations?: WhatsappCanonicalIntentOutput["calculations"];
  clarificationOptions?: WhatsappCanonicalIntentOutput["clarification_options"];
}) {
  return whatsappCanonicalIntentOutputSchema.parse({
    schema_version: WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION,
    message_id: input.messageId ?? null,
    input_modality: input.inputModality ?? "texto",
    original_text: input.text,
    normalized_text: normalizeText(input.text),
    transcribed_text: null,
    media_context: null,
    intent: input.intent,
    confidence: input.confidence,
    safety_level: "normal",
    autonomy_level: input.needsConfirmation ? "requer_confirmacao" : "automatico",
    autonomy_reason: input.ambiguityReason ?? null,
    actor_type: "usuario",
    actor_id: input.actorId == null ? null : String(input.actorId),
    target_user_id: input.targetUserId == null ? null : String(input.targetUserId),
    professional_id: null,
    context_required: input.contextRequired ?? input.needsConfirmation,
    needs_confirmation: input.needsConfirmation,
    pending_context_id: input.pendingContextId ?? null,
    pending_proposal_id: null,
    requested_output_type: input.requestedOutputType ?? null,
    requested_period: null,
    user_timezone: null,
    temporal_expression: null,
    resolved_date: null,
    resolved_time_range: null,
    meal_slot: null,
    extracted_items: [],
    extracted_actions: [],
    calculations: input.calculations ?? [],
    source_recommendation: null,
    clarification_options: input.clarificationOptions ?? [],
    processing_strategy: "canonical_pre_nutrition_router",
    warnings: input.warnings ?? [],
    ambiguity_reason: input.ambiguityReason ?? null,
  });
}

function buildRuntimeCanonical(input: RouteInput, runtimeIntent: WhatsappInterpretedIntent) {
  return buildCanonicalIntentOutputFromRuntime({
    runtimeIntent,
    messageId: input.messageId,
    originalText: input.text,
    normalizedText: normalizeText(input.text),
    inputModality: input.inputModality ?? "texto",
    processingStrategy: "canonical_pre_nutrition_router",
    actorId: input.actorId,
    targetUserId: input.targetUserId,
  });
}

function buildClarificationResponse(canonical: WhatsappCanonicalIntentOutput, reply: string, detail: string): WhatsappRouterSafeResponse {
  return {
    handled: true,
    action: "router_clarification_needed",
    reply,
    eventType: "whatsapp.router.clarification_needed",
    detail,
    data: {
      canonicalIntent: canonical.intent,
      confidence: canonical.confidence,
      schemaVersion: canonical.schema_version,
    },
  };
}

function routeIsolatedNumber(input: RouteInput, normalized: string): WhatsappPreNutritionRouterDecision | null {
  if (!/^\d+(?:[,.]\d+)?$/.test(normalized)) return null;

  if (input.pendingContextId) {
    const canonical = buildBaseCanonical({
      ...input,
      intent: "selecionar_opcao",
      confidence: 0.86,
      needsConfirmation: false,
      contextRequired: true,
      ambiguityReason: input.pendingContextKind ?? "Resposta curta associada a contexto pendente.",
    });
    return {
      canonical,
      shouldUseNutritionFallback: false,
      response: {
        handled: true,
        action: "router_contextual_response",
        reply: "Recebi sua resposta. Vou usar essa opção no contexto pendente.",
        eventType: "whatsapp.router.contextual_response",
        detail: "Número isolado roteado como seleção por existir contexto pendente.",
        data: { canonicalIntent: canonical.intent, pendingContextId: input.pendingContextId },
      },
      reason: "isolated_number_with_pending_context",
    };
  }

  const canonical = buildBaseCanonical({
    ...input,
    intent: "mensagem_ambigua",
    confidence: 0.74,
    needsConfirmation: true,
    ambiguityReason: "Número isolado sem contexto pendente não deve ser interpretado como alimento.",
    clarificationOptions: [
      { id: "registrar", label: "Registrar uma quantidade de alimento", intent: "registrar_alimento" },
      { id: "selecionar", label: "Responder uma opção pendente", intent: "selecionar_opcao" },
    ],
  });
  return {
    canonical,
    shouldUseNutritionFallback: false,
    response: buildClarificationResponse(
      canonical,
      "Recebi apenas um número. Você quer responder uma opção pendente ou registrar uma quantidade de algum alimento?",
      "Número isolado sem contexto pendente bloqueado antes do parser nutricional.",
    ),
    reason: "isolated_number_without_context",
  };
}

function routeCalculation(input: RouteInput, normalized: string): WhatsappPreNutritionRouterDecision | null {
  const match = normalized.match(/^(\d+(?:[,.]\d+)?)\s*([+\-*/])\s*(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|gramas?|litros?)$/);
  if (!match) return null;

  const left = parseNumber(match[1]);
  const right = parseNumber(match[3]);
  const operator = match[2];
  const result = operator === "+" ? left + right
    : operator === "-" ? left - right
      : operator === "*" ? left * right
        : right === 0 ? null : left / right;
  const unit = match[4];
  const canonical = buildBaseCanonical({
    ...input,
    intent: "calcular_quantidade",
    confidence: 0.9,
    needsConfirmation: true,
    ambiguityReason: "Conta com unidade deve ser calculada antes de qualquer registro alimentar.",
    calculations: [{
      expression: input.text,
      result_value: result == null ? null : Number(result.toFixed(2)),
      result_unit: unit,
      confidence: 0.9,
    }],
  });

  return {
    canonical,
    shouldUseNutritionFallback: false,
    response: {
      handled: true,
      action: "router_calculation_detected",
      reply: result == null
        ? "Identifiquei uma conta com unidade, mas não consigo dividir por zero. Me envie a quantidade correta."
        : `O resultado é ${Number(result.toFixed(2)).toLocaleString("pt-BR")} ${unit}. Quer usar esse valor em algum alimento?`,
      eventType: "whatsapp.router.calculation_detected",
      detail: "Conta matemática com unidade roteada antes do parser nutricional.",
      data: { canonicalIntent: canonical.intent, resultValue: result, resultUnit: unit },
    },
    reason: "calculation_with_unit",
  };
}

function routeNonFoodRequests(input: RouteInput, normalized: string): WhatsappPreNutritionRouterDecision | null {
  const patterns: Array<{
    pattern: RegExp;
    intent: WhatsappCanonicalIntentName;
    outputType: WhatsappCanonicalIntentOutput["requested_output_type"];
    reply: string;
    reason: string;
  }> = [
    { pattern: /\b(resuma|resumo|total|calorias)\b.*\b(dia|hoje|ontem|semana|mes)\b/, intent: "resumo_dia", outputType: "resumo", reply: "Consigo montar um resumo. Me diga o período se quiser algo diferente de hoje.", reason: "summary_request" },
    { pattern: /\b(grafico|grafica|evolucao)\b/, intent: "gerar_grafico", outputType: "grafico", reply: "Entendi que você quer um gráfico. Essa solicitação não será tratada como alimento.", reason: "chart_request" },
    { pattern: /\b(relatorio|relatorio|exportar|pdf)\b/, intent: "gerar_relatorio", outputType: "relatorio", reply: "Entendi que você quer um relatório. Me diga o período para eu preparar a consulta correta.", reason: "report_request" },
    { pattern: /\b(sugira|sugestao|sugestao|o que comer|opcao de refeicao|lanche da tarde)\b/, intent: "sugestao_refeicao", outputType: "sugestao", reply: "Entendi que você quer uma sugestão. Não vou registrar isso como alimento.", reason: "suggestion_request" },
    { pattern: /\b(meta|objetivo|evolucao|proteina|caloria|carboidrato|gordura)\b.*\?$/, intent: "pergunta_sobre_meta", outputType: "texto", reply: "Entendi sua pergunta. Vou tratar isso como consulta, não como registro alimentar.", reason: "question_request" },
  ];

  const found = patterns.find(entry => entry.pattern.test(normalized));
  if (!found) return null;

  const canonical = buildBaseCanonical({
    ...input,
    intent: found.intent,
    confidence: 0.82,
    needsConfirmation: true,
    requestedOutputType: found.outputType,
    ambiguityReason: "Mensagem não alimentar bloqueada antes do parser nutricional.",
  });
  return {
    canonical,
    shouldUseNutritionFallback: false,
    response: buildClarificationResponse(canonical, found.reply, "Pedido não alimentar roteado antes do parser nutricional."),
    reason: found.reason,
  };
}

function parseLikelyFoodWithQuantity(input: RouteInput): WhatsappPreNutritionRouterDecision | null {
  const match = input.text.match(/\b(\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|ml|l|un|unidades?|fatias?|x[ií]caras?|copos?|colheres?|por[cç][oõ]es?|por[cç][aã]o)\b\s*(?:de\s+)?(.+)$/i);
  if (!match) return null;

  const quantity = parseNumber(match[1]);
  const unit = match[2];
  const foodName = match[3]
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  if (!foodName || /^(agua|água)$/i.test(foodName)) return null;

  const runtimeIntent: WhatsappInterpretedIntent = {
    intent: "add_foods_to_meal",
    confidence: 0.78,
    meal: null,
    items: [{ foodName, quantity, unit }],
    requiresConfirmation: false,
    possibleIntents: [],
    reason: "Alimento com quantidade detectado antes do fallback nutricional.",
  };
  return {
    canonical: buildRuntimeCanonical(input, runtimeIntent),
    shouldUseNutritionFallback: true,
    response: null,
    reason: "likely_food_with_quantity",
  };
}

export function routeWhatsappMessageBeforeNutrition(input: RouteInput): WhatsappPreNutritionRouterDecision {
  const normalized = normalizeText(input.text);

  const ruleDecision = routeIsolatedNumber(input, normalized)
    ?? routeCalculation(input, normalized)
    ?? routeNonFoodRequests(input, normalized)
    ?? parseLikelyFoodWithQuantity(input);
  if (ruleDecision) return ruleDecision;

  const runtimeIntent = classifyWhatsappMessageDeterministically(input.text);
  const canonical = buildRuntimeCanonical(input, runtimeIntent);
  const canUseNutritionFallback = canonical.intent === "registrar_alimento" || canonical.intent === "adicionar_alimento";

  if (canUseNutritionFallback && runtimeIntent.intent === "add_foods_to_meal" && runtimeIntent.confidence >= 0.5) {
    return {
      canonical,
      shouldUseNutritionFallback: true,
      response: null,
      reason: "runtime_food_intent",
    };
  }

  return {
    canonical,
    shouldUseNutritionFallback: false,
    response: buildClarificationResponse(
      canonical,
      runtimeIntent.clarificationQuestion ?? "Não entendi com segurança. Você quer registrar alimento, corrigir uma refeição ou consultar seus registros?",
      "Mensagem bloqueada antes do parser nutricional por não ter sinal alimentar seguro.",
    ),
    reason: "safe_non_food_or_ambiguous",
  };
}
