import type { CanonicalWhatsappIntentName } from "./canonicalIntentSchema";

export type WhatsappPendingContextKind = "selection" | "quantity" | "confirmation" | "professional_decision";

export type WhatsappIntentRouteAction =
  | "continue_pipeline"
  | "safe_clarification"
  | "safe_non_food_response"
  | "route_to_pending_context";

export type WhatsappIntentRouteDecision = {
  action: WhatsappIntentRouteAction;
  canonicalIntent: CanonicalWhatsappIntentName;
  confidence: number;
  shouldAllowNutritionFallback: boolean;
  reason: string;
  reply: string | null;
  eventType: string;
  detail: string;
  data: {
    pendingContextKind: WhatsappPendingContextKind | null;
    calculation: {
      expression: string;
      result: number | null;
      unit: string | null;
    } | null;
    possibleIntents: CanonicalWhatsappIntentName[];
  };
};

type EvaluateWhatsappIntentRouteInput = {
  text?: string | null;
  pendingContextKind?: WhatsappPendingContextKind | null;
};

const FOOD_REGISTRATION_WORDS = /\b(?:comi|almocei|jantei|lanchei|ceei|tomei|bebi|registre|registrar|adicionar|adicione|inclua|incluir)\b/;
const FOOD_OR_MEAL_WORDS = /\b(?:arroz|feijao|feijao|banana|frango|carne|ovo|ovos|pao|cafe|leite|iogurte|aveia|salada|macarrao|batata|refeicao|almoco|jantar|lanche|ceia|agua|hidratacao)\b/;
const QUANTITY_WITH_UNIT = /\b\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|mg|ml|l|litros?|un|unidades?|fatias?|xicaras?|copos?|colheres?|porcoes?|porcao)\b/;
const SHORT_CONFIRMATION = /^(?:s|sim|nao|não|ok|certo|confirmo|cancelar|cancela)$/i;
const ISOLATED_NUMBER = /^\d+(?:[,.]\d+)?$/;
const OPTION_SELECTION = /^(?:opcao\s*)?\d+$/;
const MATH_WITH_UNIT = /^\s*\d+(?:[,.]\d+)?(?:\s*[+\-*/]\s*\d+(?:[,.]\d+)?)+\s*(?:g|gr|gramas?|kg|mg|ml|l|litros?)\s*$/i;
const QUESTION_WORDS = /\b(?:por que|porque|como|qual|quais|posso|devo|vale a pena|faz mal|faz bem)\b/;

function normalizeText(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function routeDecision(input: Omit<WhatsappIntentRouteDecision, "eventType" | "detail">): WhatsappIntentRouteDecision {
  return {
    ...input,
    eventType: `whatsapp.router.${input.canonicalIntent}`,
    detail: input.reason,
  };
}

function safeClarification(input: {
  canonicalIntent: CanonicalWhatsappIntentName;
  confidence: number;
  reason: string;
  reply: string;
  possibleIntents?: CanonicalWhatsappIntentName[];
  calculation?: WhatsappIntentRouteDecision["data"]["calculation"];
}): WhatsappIntentRouteDecision {
  return routeDecision({
    action: "safe_clarification",
    canonicalIntent: input.canonicalIntent,
    confidence: input.confidence,
    shouldAllowNutritionFallback: false,
    reason: input.reason,
    reply: input.reply,
    data: {
      pendingContextKind: null,
      calculation: input.calculation ?? null,
      possibleIntents: input.possibleIntents ?? [],
    },
  });
}

function safeNonFood(input: {
  canonicalIntent: CanonicalWhatsappIntentName;
  confidence: number;
  reason: string;
  reply: string;
  possibleIntents?: CanonicalWhatsappIntentName[];
}): WhatsappIntentRouteDecision {
  return routeDecision({
    action: "safe_non_food_response",
    canonicalIntent: input.canonicalIntent,
    confidence: input.confidence,
    shouldAllowNutritionFallback: false,
    reason: input.reason,
    reply: input.reply,
    data: {
      pendingContextKind: null,
      calculation: null,
      possibleIntents: input.possibleIntents ?? [],
    },
  });
}

function continuePipeline(input: {
  canonicalIntent: CanonicalWhatsappIntentName;
  confidence: number;
  shouldAllowNutritionFallback: boolean;
  reason: string;
  possibleIntents?: CanonicalWhatsappIntentName[];
}): WhatsappIntentRouteDecision {
  return routeDecision({
    action: "continue_pipeline",
    canonicalIntent: input.canonicalIntent,
    confidence: input.confidence,
    shouldAllowNutritionFallback: input.shouldAllowNutritionFallback,
    reason: input.reason,
    reply: null,
    data: {
      pendingContextKind: null,
      calculation: null,
      possibleIntents: input.possibleIntents ?? [],
    },
  });
}

function parseMathWithUnit(text: string) {
  const match = text.match(/^\s*((?:\d+(?:[,.]\d+)?\s*[+\-*/]\s*)+\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|mg|ml|l|litros?)\s*$/i);
  if (!match) return null;
  const expression = match[1].replace(/,/g, ".");
  if (!/^[\d.+\-*/\s]+$/.test(expression)) return null;
  const result = expression
    .split(/([+\-*/])/)
    .map(part => part.trim())
    .filter(Boolean)
    .reduce<{ value: number | null; op: string | null }>((state, part) => {
      if (["+", "-", "*", "/"].includes(part)) {
        return { ...state, op: part };
      }
      const number = Number(part);
      if (!Number.isFinite(number)) return { value: null, op: null };
      if (state.value === null) return { value: number, op: null };
      if (state.op === "+") return { value: state.value + number, op: null };
      if (state.op === "-") return { value: state.value - number, op: null };
      if (state.op === "*") return { value: state.value * number, op: null };
      if (state.op === "/") return { value: number === 0 ? null : state.value / number, op: null };
      return { value: null, op: null };
    }, { value: null, op: null }).value;

  return {
    expression: match[1].trim(),
    result: result === null ? null : Number(result.toFixed(2)),
    unit: match[2],
  };
}

function isLikelyFoodMessage(text: string) {
  return QUANTITY_WITH_UNIT.test(text) || FOOD_REGISTRATION_WORDS.test(text) || FOOD_OR_MEAL_WORDS.test(text);
}

function isQuestionWithoutRegistrationSignal(text: string) {
  return QUESTION_WORDS.test(text) && !QUANTITY_WITH_UNIT.test(text) && !FOOD_REGISTRATION_WORDS.test(text);
}

export function evaluateWhatsappIntentRoute(input: EvaluateWhatsappIntentRouteInput): WhatsappIntentRouteDecision {
  const text = normalizeText(input.text);
  if (!text) {
    return safeClarification({
      canonicalIntent: "pedir_esclarecimento",
      confidence: 0.9,
      reason: "Mensagem vazia ou sem texto normalizado.",
      reply: "Não recebi uma mensagem para interpretar. Envie o alimento, comando ou pergunta que deseja registrar.",
    });
  }

  if (input.pendingContextKind && (SHORT_CONFIRMATION.test(text) || OPTION_SELECTION.test(text))) {
    return routeDecision({
      action: "route_to_pending_context",
      canonicalIntent: input.pendingContextKind === "selection"
        ? "selecionar_opcao"
        : input.pendingContextKind === "confirmation"
          ? "confirmacao_sim_nao"
          : input.pendingContextKind === "professional_decision"
            ? "paciente_aceita_sugestao"
            : "adicionar_alimento",
      confidence: 0.88,
      shouldAllowNutritionFallback: false,
      reason: "Resposta curta roteada para contexto pendente antes de qualquer fallback nutricional.",
      reply: null,
      data: {
        pendingContextKind: input.pendingContextKind,
        calculation: null,
        possibleIntents: [],
      },
    });
  }

  if (SHORT_CONFIRMATION.test(text)) {
    return safeClarification({
      canonicalIntent: "confirmacao_sim_nao",
      confidence: 0.86,
      reason: "Confirmação curta recebida sem contexto pendente explícito.",
      reply: "Recebi sua resposta, mas não encontrei uma pendência ativa para confirmar. Envie o alimento, ajuste ou opção completa.",
      possibleIntents: ["confirmar_alteracao_meta", "selecionar_opcao", "mensagem_ambigua"],
    });
  }

  if (ISOLATED_NUMBER.test(text)) {
    return safeClarification({
      canonicalIntent: "selecionar_opcao",
      confidence: 0.87,
      reason: "Número isolado sem contexto pendente não deve virar alimento.",
      reply: "Recebi um número, mas não encontrei uma lista ou pendência ativa. Me diga o que esse número representa.",
      possibleIntents: ["selecionar_opcao", "adicionar_alimento", "mensagem_ambigua"],
    });
  }

  if (MATH_WITH_UNIT.test(text)) {
    const calculation = parseMathWithUnit(text);
    return safeClarification({
      canonicalIntent: "calcular_quantidade",
      confidence: 0.9,
      reason: "Conta matemática com unidade detectada antes do registro alimentar.",
      reply: calculation && calculation.result !== null
        ? `Calculei ${calculation.expression} ${calculation.unit}: ${calculation.result} ${calculation.unit}. Se quiser registrar essa quantidade, envie junto com o alimento.`
        : "Entendi uma conta com unidade, mas não consegui calcular com segurança. Envie a quantidade final junto com o alimento.",
      calculation,
    });
  }

  if (/\b(?:grafico|grafico|gráfico|evolucao|evolução)\b/.test(text)) {
    return safeNonFood({
      canonicalIntent: "gerar_grafico",
      confidence: 0.84,
      reason: "Pedido de gráfico/evolução não deve cair no parser de alimentos.",
      reply: "Ainda não gero gráfico direto por aqui. Posso ajudar com um resumo do dia ou você pode abrir os registros no app.",
    });
  }

  if (/\b(?:resumo|resuma|relatorio|relatório|historico|histórico|calorias de hoje|semana|mes|mês)\b/.test(text)) {
    return continuePipeline({
      canonicalIntent: /\b(?:relatorio|relatório|historico|histórico)\b/.test(text) ? "gerar_relatorio" : "resumo_periodo",
      confidence: 0.78,
      shouldAllowNutritionFallback: false,
      reason: "Pedido de resumo/relatório deve ser tratado por fluxo próprio antes do fallback alimentar.",
      possibleIntents: ["resumo_dia", "resumo_periodo", "gerar_relatorio"],
    });
  }

  if (/\b(?:sugira|sugestao|sugestão|o que comer|ideia de lanche|opcao de lanche|opção de lanche)\b/.test(text)) {
    return continuePipeline({
      canonicalIntent: "sugestao_refeicao",
      confidence: 0.78,
      shouldAllowNutritionFallback: false,
      reason: "Pedido de sugestão deve ser roteado para resposta própria, não para registro de alimento.",
      possibleIntents: ["sugestao_refeicao", "sugestao_alimento"],
    });
  }

  if (isQuestionWithoutRegistrationSignal(text)) {
    return safeNonFood({
      canonicalIntent: /\b(?:dor|remedio|remédio|doenca|doença|sintoma|emergencia|emergência|pressao|pressão)\b/.test(text)
        ? "pergunta_saude_dieta"
        : "pergunta_sobre_alimento",
      confidence: 0.74,
      reason: "Pergunta sem alimento registrável não deve gerar refeição por fallback.",
      reply: "Posso ajudar com registros e resumos alimentares. Para registrar, envie alimento e quantidade; para dúvidas gerais, descreva melhor o que quer analisar.",
    });
  }

  if (/\b(?:excluir|remover|apagar|deletar)\b/.test(text)) {
    return continuePipeline({
      canonicalIntent: "excluir_alimento",
      confidence: 0.74,
      shouldAllowNutritionFallback: false,
      reason: "Comando de remoção deve ser tratado por fluxo próprio antes do fallback alimentar.",
      possibleIntents: ["excluir_alimento", "excluir_refeicao", "selecionar_opcao"],
    });
  }

  if (/\b(?:trocar|troque|corrigir|corrija|alterar|ajustar|mudar|nao e|não é)\b/.test(text)) {
    return continuePipeline({
      canonicalIntent: "corrigir_alimento",
      confidence: 0.78,
      shouldAllowNutritionFallback: false,
      reason: "Comando de ajuste/correção deve passar por ações próprias antes do fallback alimentar.",
      possibleIntents: ["corrigir_alimento", "trocar_alimento", "somar_quantidade"],
    });
  }

  if (isLikelyFoodMessage(text)) {
    return continuePipeline({
      canonicalIntent: FOOD_REGISTRATION_WORDS.test(text) ? "adicionar_alimento" : "registrar_alimento",
      confidence: 0.76,
      shouldAllowNutritionFallback: true,
      reason: "Mensagem parece alimentar e pode seguir para ações existentes ou fallback nutricional.",
    });
  }

  return safeClarification({
    canonicalIntent: "mensagem_ambigua",
    confidence: 0.68,
    reason: "Mensagem sem alimento, comando ou pergunta suficientemente clara.",
    reply: "Não entendi com segurança. Você quer registrar um alimento, corrigir uma refeição ou consultar seus registros?",
    possibleIntents: ["registrar_alimento", "corrigir_alimento", "consulta_historico"],
  });
}

export function buildWhatsappRouterResult(decision: WhatsappIntentRouteDecision) {
  return {
    handled: true,
    action: "router_safe_response",
    reply: decision.reply ?? "Preciso de mais contexto antes de continuar.",
    eventType: decision.eventType,
    detail: decision.detail,
    data: {
      canonicalIntent: decision.canonicalIntent,
      confidence: decision.confidence,
      routeAction: decision.action,
      shouldAllowNutritionFallback: decision.shouldAllowNutritionFallback,
      ...decision.data,
    },
  };
}
