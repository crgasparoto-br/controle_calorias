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

type NumericAdjustmentCommand = {
  canonicalIntent: Extract<CanonicalWhatsappIntentName, "adicionar_alimento" | "somar_quantidade" | "corrigir_alimento" | "excluir_alimento">;
  kind: "add" | "sum" | "correction" | "removal";
  value: string;
  unit: string | null;
  target: string | null;
};

const FOOD_REGISTRATION_WORDS = /\b(?:comi|almocei|jantei|lanchei|ceei|tomei|bebi|registre|registrar|adicionar|adicione|inclua|incluir)\b/;
const FOOD_OR_MEAL_WORDS = /\b(?:arroz|feijao|feijao|banana|frango|carne|ovo|ovos|pao|cafe|leite|iogurte|aveia|salada|macarrao|batata|refeicao|almoco|jantar|lanche|ceia|agua|hidratacao)\b/;
const QUANTITY_WITH_UNIT = /\b\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|mg|ml|l|litros?|un|unidades?|fatias?|xicaras?|copos?|colheres?|porcoes?|porcao)\b/;
const SHORT_CONFIRMATION = /^(?:s|sim|nao|não|ok|certo|confirmo|cancelar|cancela)$/i;
const ISOLATED_NUMBER = /^\d+(?:[,.]\d+)?$/;
const OPTION_SELECTION = /^(?:opcao\s*)?\d+$/;
const MATH_WITH_UNIT = /^\s*\d+(?:[,.]\d+)?(?:\s*[+\-*/]\s*\d+(?:[,.]\d+)?)+\s*(?:g|gr|gramas?|kg|mg|ml|l|litros?)\s*$/i;
const QUESTION_WORDS = /\b(?:por que|porque|como|qual|quais|posso|devo|vale a pena|faz mal|faz bem)\b/;
const FOOD_QUESTION_WORDS = /\b(?:tem muita caloria|tem poucas calorias|quantas calorias|calorico|calorica|engorda|e bom|e ruim|vale a pena)\b/;
const ANALYSIS_CONTEXT_QUESTION_WORDS = /\b(?:meta|objetivo|caloria alvo|deficit|superavit|evolucao|progresso|resultado|estou indo bem|como estou|qualidade|ultraprocessado|ultra processado|saudavel|balanceado|bom ou ruim|melhorar alimentacao)\b/;
const NUMERIC_ADJUSTMENT_WITH_UNIT = /^\s*(somar|soma|some|adicionar|adicione|adiciona|acrescentar|acrescente|aumentar|aumente|corrigir|corrija|ajustar|ajuste|alterar|altere)\s+(\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|mg|ml|l|litros?|un|unidades?|fatias?|xicaras?|copos?|colheres?|porcoes?|porcao)\b(?:\s+(?:de\s+|do\s+|da\s+|no\s+|na\s+)?(.+))?\s*$/i;
const NUMERIC_REMOVAL_COMMAND = /^\s*(excluir|exclua|exclui|remover|remova|remove|apagar|apague|apaga|deletar|delete)\s+(\d+(?:[,.]\d+)?)(?:\s+(?:de\s+|do\s+|da\s+|no\s+|na\s+)?(.+))?\s*$/i;
const ANALYSIS_REQUEST_WORDS = /\b(?:analise|analisar|avalie|avaliar|resuma|resumo|relatorio|historico|grafico|visualizacao|sugira|sugestao|meta|objetivo|evolucao|progresso|qualidade|consulta)\b/;
const HEALTH_URGENCY_WORDS = /\b(?:passando mal|passei mal|desmaio|desmaiando|desmaiei|dor no peito|falta de ar|nao consigo respirar|pressao alta|pressao esta alta|pressao muito alta|hipoglicemia|convulsao|sangramento|emergencia|urgencia|socorro)\b/;
const SENSITIVE_HEALTH_WORDS = /\b(?:diabetico|diabetes|hipertensao|pressao|gravida|gestante|renal|rim|figado|colesterol|triglicerides|remedio|medicamento|insulina|antidepressivo|ansiedade|depressao|transtorno alimentar|compulsao|anorexia|bulimia|alergia|intolerancia)\b/;
const DIET_CARE_WORDS = /\b(?:jejum|dieta cetogenica|low carb|suplemento|creatina|whey|termogenico|calorias devo cortar|devo cortar calorias|quantas calorias devo cortar|posso fazer|posso tomar|posso comer)\b/;
const PROFESSIONAL_OR_PRESCRIPTION_WORDS = /\b(?:nutricionista|medico|profissional|prescrever|prescricao|receita|tratamento|plano terapeutico|conduta)\b/;

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

function routePendingContext(input: {
  pendingContextKind: WhatsappPendingContextKind;
  canonicalIntent: CanonicalWhatsappIntentName;
  confidence: number;
  reason: string;
  possibleIntents?: CanonicalWhatsappIntentName[];
}) {
  return routeDecision({
    action: "route_to_pending_context",
    canonicalIntent: input.canonicalIntent,
    confidence: input.confidence,
    shouldAllowNutritionFallback: false,
    reason: input.reason,
    reply: null,
    data: {
      pendingContextKind: input.pendingContextKind,
      calculation: null,
      possibleIntents: input.possibleIntents ?? [],
    },
  });
}

function evaluateArithmeticExpression(expression: string) {
  const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/]/g);
  if (!tokens?.length) return null;

  const values: number[] = [];
  const operators: string[] = [];
  const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const applyOperator = () => {
    const operator = operators.pop();
    const right = values.pop();
    const left = values.pop();
    if (!operator || left === undefined || right === undefined) return false;
    if (operator === "/" && right === 0) return false;
    const result = operator === "+"
      ? left + right
      : operator === "-"
        ? left - right
        : operator === "*"
          ? left * right
          : left / right;
    values.push(result);
    return true;
  };

  for (const token of tokens) {
    if (/^[+\-*/]$/.test(token)) {
      while (operators.length && precedence[operators[operators.length - 1]] >= precedence[token]) {
        if (!applyOperator()) return null;
      }
      operators.push(token);
      continue;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }

  while (operators.length) {
    if (!applyOperator()) return null;
  }

  return values.length === 1 && Number.isFinite(values[0]) ? Number(values[0].toFixed(2)) : null;
}

function parseMathWithUnit(text: string) {
  const match = text.match(/^\s*((?:\d+(?:[,.]\d+)?\s*[+\-*/]\s*)+\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|mg|ml|l|litros?)\s*$/i);
  if (!match) return null;
  const expression = match[1].replace(/,/g, ".");
  if (!/^[\d.+\-*/\s]+$/.test(expression)) return null;
  const result = evaluateArithmeticExpression(expression);

  return {
    expression: match[1].trim(),
    result,
    unit: match[2],
  };
}

function parseNumericAdjustmentCommand(text: string): NumericAdjustmentCommand | null {
  const removal = text.match(NUMERIC_REMOVAL_COMMAND);
  if (removal) {
    return {
      canonicalIntent: "excluir_alimento",
      kind: "removal",
      value: removal[2],
      unit: null,
      target: removal[3]?.trim() || null,
    };
  }

  const adjustment = text.match(NUMERIC_ADJUSTMENT_WITH_UNIT);
  if (!adjustment) return null;

  const verb = adjustment[1];
  const target = adjustment[4]?.trim() || null;
  if (/^(adicionar|adicione|adiciona)$/.test(verb) && target && FOOD_OR_MEAL_WORDS.test(target)) {
    return null;
  }

  const isCorrection = /^(corrigir|corrija|ajustar|ajuste|alterar|altere)$/.test(verb);
  const isExplicitAdd = /^(adicionar|adicione|adiciona)$/.test(verb);

  return {
    canonicalIntent: isCorrection ? "corrigir_alimento" : isExplicitAdd ? "adicionar_alimento" : "somar_quantidade",
    kind: isCorrection ? "correction" : isExplicitAdd ? "add" : "sum",
    value: adjustment[2],
    unit: adjustment[3],
    target,
  };
}

function routeNumericAdjustmentCommand(input: {
  command: NumericAdjustmentCommand;
  pendingContextKind?: WhatsappPendingContextKind | null;
}): WhatsappIntentRouteDecision {
  if (input.pendingContextKind) {
    return routePendingContext({
      pendingContextKind: input.pendingContextKind,
      canonicalIntent: input.command.canonicalIntent,
      confidence: 0.86,
      reason: "Comando numerico roteado para contexto pendente antes do fallback alimentar.",
      possibleIntents: [input.command.canonicalIntent, "selecionar_opcao"],
    });
  }

  if (input.command.target) {
    return continuePipeline({
      canonicalIntent: input.command.canonicalIntent,
      confidence: 0.78,
      shouldAllowNutritionFallback: input.command.kind === "add",
      reason: input.command.kind === "add"
        ? "Comando de adicao com quantidade e alimento deve poder seguir para registro alimentar mesmo fora do dicionario curto."
        : "Comando numerico com alvo textual deve ser tratado por fluxo proprio antes do fallback alimentar.",
      possibleIntents: [input.command.canonicalIntent, "selecionar_opcao"],
    });
  }

  const replyByKind: Record<NumericAdjustmentCommand["kind"], string> = {
    add: "Entendi que você quer adicionar uma quantidade, mas preciso saber o alimento. Envie, por exemplo: adicionar 30g de arroz.",
    sum: "Entendi que você quer somar uma quantidade, mas preciso saber em qual item ou refeição devo aplicar esse ajuste.",
    correction: "Entendi que você quer corrigir uma quantidade, mas preciso saber qual item ou refeição devo alterar.",
    removal: "Entendi que você quer remover uma opção, mas preciso de uma lista ativa ou do item completo para fazer isso com segurança.",
  };

  return safeClarification({
    canonicalIntent: input.command.canonicalIntent,
    confidence: 0.84,
    reason: "Comando numerico sem contexto ou alvo seguro nao deve virar alimento generico.",
    reply: replyByKind[input.command.kind],
    possibleIntents: [input.command.canonicalIntent, "selecionar_opcao", "mensagem_ambigua"],
  });
}

function isLikelyFoodMessage(text: string) {
  return QUANTITY_WITH_UNIT.test(text) || FOOD_REGISTRATION_WORDS.test(text) || FOOD_OR_MEAL_WORDS.test(text);
}

function isQuestionWithoutRegistrationSignal(text: string) {
  return (QUESTION_WORDS.test(text) || FOOD_QUESTION_WORDS.test(text)) && !FOOD_REGISTRATION_WORDS.test(text);
}

function requestedPeriod(text: string) {
  if (/\b(?:hoje|dia|diario|diaria)\b/.test(text)) return "dia";
  if (/\b(?:ontem)\b/.test(text)) return "dia";
  if (/\b(?:semana|semanal|7 dias)\b/.test(text)) return "semana";
  if (/\b(?:mes|mensal|30 dias)\b/.test(text)) return "mes";
  return null;
}

function routeHealthSafetyRequest(text: string): WhatsappIntentRouteDecision | null {
  if (HEALTH_URGENCY_WORDS.test(text)) {
    return safeNonFood({
      canonicalIntent: "possivel_urgencia_saude",
      confidence: 0.94,
      reason: "Possivel urgencia de saude bloqueada antes de qualquer fluxo alimentar ou orientacao automatica.",
      reply: "Isso pode exigir atendimento imediato. Procure um serviço de urgência ou um profissional de saúde agora. Não vou registrar alimento nem orientar conduta clínica por aqui.",
      possibleIntents: ["possivel_urgencia_saude", "pergunta_medica_sensivel"],
    });
  }

  if (SENSITIVE_HEALTH_WORDS.test(text)) {
    return safeNonFood({
      canonicalIntent: "pergunta_medica_sensivel",
      confidence: 0.88,
      reason: "Pergunta medica sensivel deve receber limite seguro sem diagnostico, prescricao ou registro alimentar.",
      reply: "Esse tema depende do seu histórico e de avaliação profissional. Posso ajudar a organizar seus registros, mas não vou diagnosticar, prescrever ou orientar conduta clínica pelo WhatsApp.",
      possibleIntents: ["pergunta_medica_sensivel", "pergunta_saude_dieta"],
    });
  }

  if (DIET_CARE_WORDS.test(text) || PROFESSIONAL_OR_PRESCRIPTION_WORDS.test(text)) {
    return safeNonFood({
      canonicalIntent: "pergunta_saude_dieta",
      confidence: 0.82,
      reason: "Pergunta de dieta, suplemento ou orientacao profissional deve receber informacao limitada e segura.",
      reply: "Posso dar apoio geral com seus registros, mas não vou prescrever jejum, suplemento, corte calórico ou plano individual pelo WhatsApp. Para uma decisão personalizada, fale com um profissional de saúde.",
      possibleIntents: ["pergunta_saude_dieta", "pergunta_medica_sensivel"],
    });
  }

  return null;
}

function routeAmbiguousFoodAnalysis(text: string) {
  if (!ANALYSIS_REQUEST_WORDS.test(text) || !FOOD_REGISTRATION_WORDS.test(text)) return null;
  return safeClarification({
    canonicalIntent: "mensagem_ambigua",
    confidence: 0.73,
    reason: "Mensagem combina registro alimentar com pedido de analise; precisa confirmar antes de salvar.",
    reply: "Entendi registro e análise na mesma mensagem. Você quer salvar esse alimento, consultar seus dados ou fazer as duas ações em sequência?",
    possibleIntents: ["registrar_alimento", "resumo_periodo", "gerar_relatorio", "mensagem_ambigua"],
  });
}

function routeAnalysisRequest(text: string): WhatsappIntentRouteDecision | null {
  const ambiguous = routeAmbiguousFoodAnalysis(text);
  if (ambiguous) return ambiguous;

  if ((QUESTION_WORDS.test(text) || FOOD_QUESTION_WORDS.test(text)) && !FOOD_REGISTRATION_WORDS.test(text) && !ANALYSIS_CONTEXT_QUESTION_WORDS.test(text)) {
    return safeNonFood({
      canonicalIntent: "pergunta_sobre_alimento",
      confidence: QUANTITY_WITH_UNIT.test(text) ? 0.82 : 0.74,
      reason: "Pergunta alimentar com ou sem quantidade nao deve criar refeicao por fallback.",
      reply: "Entendi uma pergunta sobre alimento. Não vou registrar isso como refeição; para salvar, envie como registro com alimento e quantidade.",
    });
  }

  if (/\b(?:analise|analisar|avalie|avaliar)\b/.test(text) && isLikelyFoodMessage(text)) {
    return safeClarification({
      canonicalIntent: "pergunta_sobre_qualidade_alimentar",
      confidence: 0.8,
      reason: "Pedido de analise com termos alimentares nao deve cair no fallback de registro.",
      reply: "Entendi que você quer uma análise, não um registro automático. Quer apenas analisar ou também salvar essa refeição?",
      possibleIntents: ["pergunta_sobre_qualidade_alimentar", "registrar_alimento", "mensagem_ambigua"],
    });
  }

  if (/\b(?:grafico|visualizacao|linha do tempo|curva)\b/.test(text)) {
    return safeNonFood({
      canonicalIntent: "gerar_grafico",
      confidence: 0.86,
      reason: "Pedido de grafico/visualizacao nao deve cair no parser de alimentos.",
      reply: "Ainda não gero gráfico direto por aqui. Você pode abrir os registros no app ou pedir um resumo do dia pelo WhatsApp.",
    });
  }

  if (/\b(?:relatorio|pdf|documento|exportar)\b/.test(text)) {
    return safeNonFood({
      canonicalIntent: "gerar_relatorio",
      confidence: 0.86,
      reason: "Pedido de relatorio deve receber fallback seguro enquanto o relatorio final nao existir no WhatsApp.",
      reply: "Ainda não monto relatório completo direto pelo WhatsApp. Posso ajudar com um resumo do dia ou você pode revisar os registros no app.",
    });
  }

  if (/\b(?:historico|meus registros|registros alimentares|refeicoes registradas|o que registrei|o que eu comi)\b/.test(text)) {
    return continuePipeline({
      canonicalIntent: "consulta_historico",
      confidence: 0.8,
      shouldAllowNutritionFallback: false,
      reason: "Consulta de historico deve usar fluxo de registros e nunca fallback alimentar.",
      possibleIntents: ["consulta_historico", "resumo_dia"],
    });
  }

  if (/\b(?:resumo|resuma|resumir|balanco|fechamento|total do dia|totais?|calorias de hoje|macros de hoje)\b/.test(text)) {
    const period = requestedPeriod(text);
    if (period === "semana" || period === "mes") {
      return safeNonFood({
        canonicalIntent: "resumo_periodo",
        confidence: 0.84,
        reason: "Resumo de periodo ainda nao tem executor final no WhatsApp e nao deve gerar alimento.",
        reply: "Ainda não monto resumo de semana ou mês direto pelo WhatsApp. Posso mostrar o resumo de hoje ou você pode revisar o período no app.",
        possibleIntents: ["resumo_periodo", "gerar_relatorio", "consulta_historico"],
      });
    }

    return continuePipeline({
      canonicalIntent: "resumo_dia",
      confidence: 0.8,
      shouldAllowNutritionFallback: false,
      reason: "Resumo diario deve usar fluxo de consulta existente; periodo ausente usa hoje como padrao.",
      possibleIntents: ["resumo_dia", "consulta_historico"],
    });
  }

  if (/\b(?:sugira|sugerir|sugestao|o que comer|ideia de|opcao de lanche|opcao de refeicao|jantar leve|almoco leve)\b/.test(text)) {
    const intent: CanonicalWhatsappIntentName = /\b(?:alimento|produto|ingrediente)\b/.test(text) ? "sugestao_alimento" : "sugestao_refeicao";
    return safeNonFood({
      canonicalIntent: intent,
      confidence: 0.82,
      reason: "Pedido de sugestao deve receber resposta segura sem registrar alimento.",
      reply: "Ainda não monto sugestões personalizadas por aqui. Posso ajudar a registrar o que você comeu ou mostrar seu resumo do dia.",
      possibleIntents: ["sugestao_refeicao", "sugestao_alimento"],
    });
  }

  if (/\b(?:meta|objetivo|caloria alvo|deficit|superavit)\b/.test(text)) {
    return safeNonFood({
      canonicalIntent: "pergunta_sobre_meta",
      confidence: 0.82,
      reason: "Pergunta sobre meta deve ser tratada como consulta, nao como alimento.",
      reply: "Entendi sua pergunta sobre meta. Ainda não faço essa análise completa pelo WhatsApp; revise sua meta no app ou peça um resumo do dia.",
    });
  }

  if (/\b(?:evolucao|progresso|resultado|estou indo bem|como estou)\b/.test(text)) {
    return safeNonFood({
      canonicalIntent: "pergunta_sobre_evolucao",
      confidence: 0.82,
      reason: "Pergunta sobre evolucao deve ser tratada como consulta segura.",
      reply: "Entendi sua pergunta sobre evolução. Ainda não faço essa análise completa pelo WhatsApp; você pode revisar seus registros no app.",
    });
  }

  if (/\b(?:qualidade|ultraprocessado|ultra processado|saudavel|balanceado|bom ou ruim|melhorar alimentacao)\b/.test(text)) {
    return safeNonFood({
      canonicalIntent: "pergunta_sobre_qualidade_alimentar",
      confidence: 0.8,
      reason: "Pergunta sobre qualidade alimentar deve ser consulta segura sem persistencia.",
      reply: "Entendi sua pergunta sobre qualidade alimentar. Posso ajudar com registros e resumos, mas não vou salvar isso como alimento.",
    });
  }

  return null;
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
    return routePendingContext({
      pendingContextKind: input.pendingContextKind,
      canonicalIntent: input.pendingContextKind === "selection"
        ? "selecionar_opcao"
        : input.pendingContextKind === "confirmation"
          ? "confirmacao_sim_nao"
          : input.pendingContextKind === "professional_decision"
            ? "paciente_aceita_sugestao"
            : "adicionar_alimento",
      confidence: 0.88,
      reason: "Resposta curta roteada para contexto pendente antes de qualquer fallback nutricional.",
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

  const numericAdjustmentCommand = parseNumericAdjustmentCommand(text);
  if (numericAdjustmentCommand) {
    return routeNumericAdjustmentCommand({
      command: numericAdjustmentCommand,
      pendingContextKind: input.pendingContextKind,
    });
  }

  const healthSafetyRoute = routeHealthSafetyRequest(text);
  if (healthSafetyRoute) {
    return healthSafetyRoute;
  }

  const analysisRoute = routeAnalysisRequest(text);
  if (analysisRoute) {
    return analysisRoute;
  }

  if (isQuestionWithoutRegistrationSignal(text)) {
    return safeNonFood({
      canonicalIntent: /\b(?:dor|remedio|doenca|sintoma|emergencia|pressao)\b/.test(text)
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
