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

type ParsedFoodQuantity = {
  foodName: string;
  quantity: number;
  unit: string | null;
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

function splitFoodNames(value: string) {
  return value
    .split(/\s*[,;]\s*|\s+e\s+/i)
    .map(part => part.replace(/[.,;:!?]+$/g, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function inferRequestedPeriod(normalized: string) {
  if (/\bhoje\b|\bdia\b/.test(normalized)) return "hoje";
  if (/\bontem\b/.test(normalized)) return "ontem";
  if (/\bsemana\b|\bsemanal\b|\bultimos\s+7\s+dias\b/.test(normalized)) return "semana";
  if (/\bmes\b|\bmensal\b|\bultimos\s+30\s+dias\b/.test(normalized)) return "mes";
  return null;
}

function buildBaseCanonical(input: RouteInput & {
  intent: WhatsappCanonicalIntentName;
  confidence: number;
  needsConfirmation: boolean;
  contextRequired?: boolean;
  requestedOutputType?: WhatsappCanonicalIntentOutput["requested_output_type"];
  requestedPeriod?: string | null;
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
    requested_period: input.requestedPeriod ?? null,
    user_timezone: null,
    temporal_expression: input.requestedPeriod ?? null,
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

function buildContextualResponse(canonical: WhatsappCanonicalIntentOutput, reply: string, detail: string): WhatsappRouterSafeResponse {
  return {
    handled: true,
    action: "router_contextual_response",
    reply,
    eventType: "whatsapp.router.contextual_response",
    detail,
    data: { canonicalIntent: canonical.intent, pendingContextId: canonical.pending_context_id },
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
      response: buildContextualResponse(canonical, "Recebi sua resposta. Vou usar essa opção no contexto pendente.", "Número isolado roteado como seleção por existir contexto pendente."),
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

function routeShortReply(input: RouteInput, normalized: string): WhatsappPreNutritionRouterDecision | null {
  const affirmative = /^(sim|s|ok|okay|confirmo|confirmar|isso|pode|pode sim)$/.test(normalized);
  const negative = /^(nao|n|não|cancelar|cancela|negativo)$/.test(normalized);
  if (!affirmative && !negative) return null;

  if (input.pendingContextId) {
    const canonical = buildBaseCanonical({
      ...input,
      intent: affirmative ? "confirmacao_sim_nao" : "cancelar_pendencia",
      confidence: 0.88,
      needsConfirmation: false,
      contextRequired: true,
      ambiguityReason: input.pendingContextKind ?? "Resposta curta associada a contexto pendente.",
    });
    return {
      canonical,
      shouldUseNutritionFallback: false,
      response: buildContextualResponse(canonical, "Recebi sua resposta e vou aplicá-la ao contexto pendente.", "Resposta curta roteada por existir contexto pendente."),
      reason: affirmative ? "short_affirmative_with_context" : "short_negative_with_context",
    };
  }

  const canonical = buildBaseCanonical({
    ...input,
    intent: "mensagem_ambigua",
    confidence: 0.76,
    needsConfirmation: true,
    ambiguityReason: "Resposta curta sem contexto pendente não deve alterar nem registrar dados.",
    clarificationOptions: [
      { id: "registrar", label: "Registrar alimento", intent: "registrar_alimento" },
      { id: "corrigir", label: "Corrigir uma refeição", intent: "corrigir_alimento" },
      { id: "consultar", label: "Consultar registros", intent: "consulta_historico" },
    ],
  });
  return {
    canonical,
    shouldUseNutritionFallback: false,
    response: buildClarificationResponse(canonical, "Recebi uma resposta curta, mas não há uma pendência ativa. Me diga o que você quer fazer.", "Resposta curta sem contexto pendente bloqueada antes do parser nutricional."),
    reason: affirmative ? "short_affirmative_without_context" : "short_negative_without_context",
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

function routeNumericAdjustmentCommand(input: RouteInput, normalized: string): WhatsappPreNutritionRouterDecision | null {
  const addMatch = normalized.match(/^(?:adicionar|adicione|adiciona|somar|soma|some|acrescentar|acrescente)\s+(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|gramas?|litros?)\s*(?:de\s+(.+))?$/);
  const removeMatch = normalized.match(/^(?:excluir|exclui|remover|remove|apagar|apaga|deletar|deleta)\s+(\d+(?:[,.]\d+)?)(?:\s+(.+))?$/);
  const correctionMatch = normalized.match(/^(?:corrigir|corrige|ajustar|ajusta|alterar|altera|era)\s+(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|gramas?|litros?)?$/);
  if (!addMatch && !removeMatch && !correctionMatch) return null;
  if (addMatch?.[3] && /^(?:adicionar|adicione|adiciona)\b/.test(normalized)) return null;

  if (input.pendingContextId) {
    const intent: WhatsappCanonicalIntentName = removeMatch ? "excluir_alimento" : correctionMatch ? "corrigir_alimento" : "somar_quantidade";
    const canonical = buildBaseCanonical({
      ...input,
      intent,
      confidence: 0.84,
      needsConfirmation: true,
      contextRequired: true,
      ambiguityReason: input.pendingContextKind ?? "Comando numérico associado a contexto pendente.",
    });
    return {
      canonical,
      shouldUseNutritionFallback: false,
      response: buildContextualResponse(canonical, "Recebi o comando e vou usá-lo no contexto pendente antes de alterar qualquer registro.", "Comando numérico roteado por existir contexto pendente."),
      reason: "numeric_adjustment_with_context",
    };
  }

  const intent: WhatsappCanonicalIntentName = removeMatch ? "excluir_alimento" : correctionMatch ? "corrigir_alimento" : "somar_quantidade";
  const canonical = buildBaseCanonical({
    ...input,
    intent,
    confidence: 0.72,
    needsConfirmation: true,
    ambiguityReason: "Comando numérico sem alvo seguro não deve criar nem alterar alimento automaticamente.",
    clarificationOptions: [
      { id: "ultima", label: "Usar a última refeição", intent },
      { id: "escolher", label: "Escolher item da refeição", intent: "selecionar_opcao" },
    ],
  });
  return {
    canonical,
    shouldUseNutritionFallback: false,
    response: buildClarificationResponse(canonical, "Entendi o comando, mas preciso saber qual item ou refeição devo alterar.", "Comando numérico sem contexto pendente bloqueado antes do parser nutricional."),
    reason: "numeric_adjustment_without_context",
  };
}

function routeNonFoodRequests(input: RouteInput, normalized: string): WhatsappPreNutritionRouterDecision | null {
  const requestedPeriod = inferRequestedPeriod(normalized);
  const patterns: Array<{
    pattern: RegExp;
    intent: WhatsappCanonicalIntentName;
    outputType: WhatsappCanonicalIntentOutput["requested_output_type"];
    reply: string;
    reason: string;
  }> = [
    { pattern: /\b(grafico|grafica|evolucao visual|linha do tempo)\b/, intent: "gerar_grafico", outputType: "grafico", reply: "Entendi que você quer um gráfico. Essa solicitação não será tratada como alimento.", reason: "chart_request" },
    { pattern: /\b(relatorio|exportar|pdf|documento)\b/, intent: "gerar_relatorio", outputType: "relatorio", reply: "Entendi que você quer um relatório. Me diga o período para eu preparar a consulta correta.", reason: "report_request" },
    { pattern: /\b(resuma|resumo|resumir|balanco|balanço|fechamento|total do dia|totais?)\b|\b(calorias|macros|proteinas?|carboidratos?|gorduras?)\b.*\b(dia|hoje|ontem|semana|mes)\b/, intent: requestedPeriod && requestedPeriod !== "hoje" && requestedPeriod !== "ontem" ? "resumo_periodo" : "resumo_dia", outputType: "resumo", reply: "Consigo montar um resumo. Me diga o período se quiser algo diferente de hoje.", reason: "summary_request" },
    { pattern: /\b(historico|historico alimentar|registros?|refeicoes registradas|o que registrei|o que eu comi)\b/, intent: "consulta_historico", outputType: "texto", reply: "Entendi que você quer consultar seus registros. Não vou criar alimento com essa mensagem.", reason: "history_request" },
    { pattern: /\b(sugira|sugerir|sugestao|sugestão|o que comer|opcao de refeicao|opção de refeição|ideia de|lanche da tarde|jantar leve|almoco leve|almoço leve)\b/, intent: /\b(alimento|produto|ingrediente)\b/.test(normalized) ? "sugestao_alimento" : "sugestao_refeicao", outputType: "sugestao", reply: "Entendi que você quer uma sugestão. Não vou registrar isso como alimento.", reason: "suggestion_request" },
    { pattern: /\b(meta|objetivo|caloria alvo|deficit|déficit|superavit|superávit)\b.*\?$/, intent: "pergunta_sobre_meta", outputType: "texto", reply: "Entendi sua pergunta sobre meta. Vou tratar isso como consulta, não como registro alimentar.", reason: "goal_question_request" },
    { pattern: /\b(evolucao|evolução|progresso|resultado|estou indo bem|como estou)\b/, intent: "pergunta_sobre_evolucao", outputType: "texto", reply: "Entendi sua pergunta sobre evolução. Vou responder como consulta, sem registrar alimento.", reason: "progress_question_request" },
    { pattern: /\b(qualidade|ultraprocessado|ultra processado|saudavel|saudável|balanceado|bom ou ruim|melhorar alimentacao|melhorar alimentação)\b/, intent: "pergunta_sobre_qualidade_alimentar", outputType: "texto", reply: "Entendi sua pergunta sobre qualidade alimentar. Não vou transformar isso em registro.", reason: "food_quality_question_request" },
    { pattern: /\?$|\b(tem muita caloria|quantas calorias|vale a pena|posso comer|é bom|e bom|faz mal|engorda)\b/, intent: "pergunta_sobre_alimento", outputType: "texto", reply: "Entendi sua pergunta sobre alimento. Vou tratar como consulta, sem salvar alimento.", reason: "food_question_request" },
  ];

  const found = patterns.find(entry => entry.pattern.test(normalized));
  if (!found) return null;

  const canonical = buildBaseCanonical({
    ...input,
    intent: found.intent,
    confidence: 0.84,
    needsConfirmation: true,
    requestedOutputType: found.outputType,
    requestedPeriod,
    ambiguityReason: "Mensagem de análise, consulta ou pergunta bloqueada antes do parser nutricional.",
  });
  return {
    canonical,
    shouldUseNutritionFallback: false,
    response: buildClarificationResponse(canonical, found.reply, "Pedido não alimentar roteado antes do parser nutricional."),
    reason: found.reason,
  };
}

function parseFoodQuantity(text: string): ParsedFoodQuantity | null {
  const quantityWithUnit = text.match(/\b(\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|ml|l|un|unidades?|fatias?|x[ií]caras?|copos?|colheres?|por[cç][oõ]es?|por[cç][aã]o)\b\s*(?:de\s+)?(.+)$/i);
  if (quantityWithUnit) {
    return {
      quantity: parseNumber(quantityWithUnit[1]),
      unit: quantityWithUnit[2],
      foodName: quantityWithUnit[3],
    };
  }

  const quantityWithoutUnit = text.match(/^\s*(\d+(?:[,.]\d+)?)\s+([\p{L}][\p{L}\s'-]{1,120})$/u);
  if (!quantityWithoutUnit) return null;
  return {
    quantity: parseNumber(quantityWithoutUnit[1]),
    unit: null,
    foodName: quantityWithoutUnit[2],
  };
}

function parseLikelyFoodWithQuantity(input: RouteInput): WhatsappPreNutritionRouterDecision | null {
  const parsed = parseFoodQuantity(input.text);
  if (!parsed) return null;

  const foodName = parsed.foodName
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  if (!foodName || /^(agua|água)$/i.test(foodName)) return null;

  const runtimeIntent: WhatsappInterpretedIntent = {
    intent: "add_foods_to_meal",
    confidence: parsed.unit ? 0.78 : 0.68,
    meal: null,
    items: [{ foodName, quantity: parsed.quantity, unit: parsed.unit }],
    requiresConfirmation: !parsed.unit,
    clarificationQuestion: parsed.unit ? null : "Entendi o alimento e a quantidade, mas posso precisar confirmar a porção antes de salvar com precisão.",
    possibleIntents: [],
    reason: parsed.unit
      ? "Alimento com quantidade e unidade detectado antes do fallback nutricional."
      : "Alimento com quantidade simples detectado antes do fallback nutricional.",
  };
  return {
    canonical: buildRuntimeCanonical(input, runtimeIntent),
    shouldUseNutritionFallback: true,
    response: null,
    reason: parsed.unit ? "likely_food_with_quantity" : "likely_food_with_simple_quantity",
  };
}

function routeMealNarrative(input: RouteInput, normalized: string): WhatsappPreNutritionRouterDecision | null {
  const mealVerbMatch = normalized.match(/\b(almocei|jantei|comi|lanchei|ceei|tomei|consumi)\b\s+(.+)$/);
  if (!mealVerbMatch) return null;

  const foodNames = splitFoodNames(mealVerbMatch[2]);
  if (!foodNames.length) return null;

  const runtimeIntent: WhatsappInterpretedIntent = {
    intent: "add_foods_to_meal",
    confidence: 0.7,
    meal: null,
    items: foodNames.map(foodName => ({ foodName, quantity: null, unit: null })),
    requiresConfirmation: true,
    clarificationQuestion: "Entendi os alimentos da refeição. Vou encaminhar para revisão nutricional antes de salvar.",
    possibleIntents: [],
    reason: "Narrativa de refeição detectada antes do fallback nutricional.",
  };
  return {
    canonical: buildRuntimeCanonical(input, runtimeIntent),
    shouldUseNutritionFallback: true,
    response: null,
    reason: "meal_narrative",
  };
}

export function routeWhatsappMessageBeforeNutrition(input: RouteInput): WhatsappPreNutritionRouterDecision {
  const normalized = normalizeText(input.text);

  const ruleDecision = routeIsolatedNumber(input, normalized)
    ?? routeShortReply(input, normalized)
    ?? routeCalculation(input, normalized)
    ?? routeNumericAdjustmentCommand(input, normalized)
    ?? routeNonFoodRequests(input, normalized)
    ?? parseLikelyFoodWithQuantity(input)
    ?? routeMealNarrative(input, normalized);
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
