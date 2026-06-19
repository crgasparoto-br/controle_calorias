export type WhatsAppFoodAssistantResult = {
  handled: true;
  action: "food_assistant" | "meal_intent_clarification";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

type AssistantMealContext = "breakfast" | "lunch" | "dinner" | "snack" | "pre_workout" | "post_workout" | "supper" | "general";

function normalizeAssistantText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMealContext(normalized: string) {
  return /\b(?:refeicao|cardapio|cafe da manha|cafe|manha|almoco|jantar|lanche|ceia|pre treino|pos treino)\b/.test(normalized);
}

function looksLikeFoodAssistantIntent(normalized: string) {
  if (!normalized) return false;

  if (/\b(o que|oque)\s+(?:eu\s+)?(?:posso\s+)?comer\b/.test(normalized)) return true;
  if (/\b(?:posso|devo)\s+comer\b/.test(normalized)) return true;
  if (/\bme\s+ajud[ae]\s+(?:a\s+)?(?:escolher|montar|decidir)\b/.test(normalized)) return true;
  if (/\b(?:monte|monta|montar|proponha|propoe|propor|sugira|sugerir)\b/.test(normalized) && hasMealContext(normalized)) return true;
  if (/\b(?:proposta|sugestao|opcao|ideia|dica)\s+(?:de\s+)?(?:refeicao|cardapio|cafe|almoco|jantar|lanche|ceia)\b/.test(normalized)) return true;
  if (/\bquero\s+(?:uma\s+)?opcao\b/.test(normalized) && hasMealContext(normalized)) return true;
  if (/\bme\s+indiqu[ea]\s+(?:algo|alguma\s+coisa|uma\s+opcao)?\b/.test(normalized) && /\b(?:comer|refeicao|cafe|almoco|jantar|lanche|ceia|frango|ovo|banana|arroz|salada)\b/.test(normalized)) return true;
  if (/\bmelhor\s+opcao\b/.test(normalized) && /\b(?:comer|refeicao|lanche|cafe|almoco|jantar)\b/.test(normalized)) return true;

  return /\b(?:sugestao|sugira|sugerir|dica|ideia|orientacao|recomenda|recomende|indicacao|indique)\b/.test(normalized)
    && /\b(?:alimentar|comer|cardapio|refeicao|lanche|cafe|almoco|jantar|pre treino|pos treino|ceia)\b/.test(normalized);
}

function looksLikeExplicitMealRegistration(normalized: string) {
  return /\b(?:almocei|jantei|comi|lanchei|ceei|tomei|bebi|registrei|registrar|registre|adicionar|adicione|inclua|lance|lancar|lançar)\b/.test(normalized);
}

function looksLikeAmbiguousMealDescription(normalized: string) {
  if (!normalized || looksLikeFoodAssistantIntent(normalized) || looksLikeExplicitMealRegistration(normalized)) {
    return false;
  }

  return /\b(?:cafe da manha|cafe|almoco|jantar|lanche|ceia)\b(?:\s+[a-z0-9]+){0,3}\s+com\s+\S+/.test(normalized);
}

function resolveMealContext(normalized: string): AssistantMealContext {
  if (/\b(cafe da manha|cafe|manha)\b/.test(normalized)) return "breakfast";
  if (/\b(almoco|almoco)\b/.test(normalized)) return "lunch";
  if (/\bjantar\b/.test(normalized)) return "dinner";
  if (/\blanche\b/.test(normalized)) return "snack";
  if (/\b(pre treino|antes do treino)\b/.test(normalized)) return "pre_workout";
  if (/\b(pos treino|depois do treino)\b/.test(normalized)) return "post_workout";
  if (/\b(ceia|antes de dormir|noite)\b/.test(normalized)) return "supper";
  return "general";
}

function buildAssistantReply(context: AssistantMealContext) {
  const optionsByContext: Record<AssistantMealContext, string[]> = {
    breakfast: [
      "• Iogurte natural com banana e aveia",
      "• Ovos mexidos com pão integral e fruta",
      "• Vitamina de leite/iogurte com fruta e uma fonte de fibra",
    ],
    lunch: [
      "• Arroz, feijão, frango ou ovos e salada",
      "• Carne magra, batata ou mandioca e legumes",
      "• Bowl com proteína, carboidrato simples de medir e vegetais",
    ],
    dinner: [
      "• Omelete com legumes e uma porção pequena de carboidrato",
      "• Frango ou peixe com salada e batata cozida",
      "• Sopa com proteína e legumes, evitando ficar só no caldo",
    ],
    snack: [
      "• Iogurte natural com fruta",
      "• Pão integral com queijo branco ou ovos",
      "• Fruta com castanhas ou aveia",
    ],
    pre_workout: [
      "• Banana com aveia",
      "• Pão ou tapioca com uma proteína leve",
      "• Iogurte com fruta, se faltar mais de uma hora para treinar",
    ],
    post_workout: [
      "• Refeição com proteína e carboidrato: frango com arroz, ovos com pão ou iogurte com fruta",
      "• Priorize proteína suficiente e reponha energia sem exagerar na gordura",
      "• Se foi treino longo, inclua água e uma fonte de carboidrato",
    ],
    supper: [
      "• Iogurte ou leite com aveia",
      "• Omelete simples ou queijo branco com fruta",
      "• Algo leve, com proteína, se a fome estiver atrapalhando o sono",
    ],
    general: [
      "• Combine uma proteína, um carboidrato fácil de medir e vegetais ou fruta",
      "• Para perder gordura, prefira opções mais simples e ricas em proteína",
      "• Para ganhar massa, não esqueça uma boa fonte de carboidrato junto da proteína",
    ],
  };

  return [
    "Sugestão alimentar:",
    "",
    "Posso te ajudar com uma escolha prática. Algumas boas opções:",
    ...optionsByContext[context],
    "",
    "Nada foi registrado como consumo.",
    "Dica rápida: me diga objetivo, horário, fome e o que você tem disponível para eu sugerir algo mais certeiro.",
    "Para registrar uma refeição, envie a descrição ou uma foto do prato.",
  ].join("\n");
}

function buildAmbiguousMealReply() {
  return "Você quer registrar essa refeição como consumida ou receber uma sugestão de refeição com esses alimentos?";
}

export function executeWhatsAppFoodAssistantIntent(text?: string | null): WhatsAppFoodAssistantResult | null {
  const normalized = normalizeAssistantText(text?.trim() || "");
  if (looksLikeAmbiguousMealDescription(normalized)) {
    return {
      handled: true,
      action: "meal_intent_clarification",
      reply: buildAmbiguousMealReply(),
      eventType: "whatsapp.intent.meal_intent_clarification",
      detail: "Mensagem alimentar ambígua pediu confirmação antes de registrar ou sugerir refeição.",
      data: { possibleIntents: ["add_foods_to_meal", "meal_suggestion"] },
    };
  }

  if (!looksLikeFoodAssistantIntent(normalized)) {
    return null;
  }

  const context = resolveMealContext(normalized);
  return {
    handled: true,
    action: "food_assistant",
    reply: buildAssistantReply(context),
    eventType: "whatsapp.intent.food_assistant",
    detail: "Orientação alimentar respondida pelo WhatsApp sem criar refeição por fallback.",
    data: { context },
  };
}
