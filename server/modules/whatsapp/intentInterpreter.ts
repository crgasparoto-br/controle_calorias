import { getAiProvider } from "../../_core/aiProvider";
import {
  parseWhatsappInterpretedIntent,
  type WhatsappInterpretedIntent,
  whatsappIntentJsonSchema,
} from "./intentSchema";
import type { WhatsappIntentContext } from "./intentContext";

type InterpretOptions = {
  useLlm?: boolean;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:,.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFoodText(value?: string | null) {
  return value
    ?.replace(/\b(?:sim|isso|por favor|pfv)\b/gi, " ")
    .replace(/^\s*(?:de|do|da|dos|das)\s+/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function parseQuantity(value: string) {
  const match = value.match(/(\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|ml|l|fatias?|x[ií]caras?|copos?|un|unidades?)\b/i);
  if (!match) {
    return null;
  }
  return {
    quantity: Number(match[1].replace(",", ".")),
    unit: match[2],
    raw: match[0],
    index: match.index ?? 0,
  };
}

function splitFoodItems(value: string) {
  return value
    .split(/\s*[;,]\s*|\s+\be\s+(?=\d|caf[eé]\b)/i)
    .map(part => part.trim())
    .filter(Boolean);
}

function buildFoodItems(itemsText: string): WhatsappInterpretedIntent["items"] {
  return splitFoodItems(itemsText).flatMap(part => {
    const quantity = parseQuantity(part);
    if (!quantity) {
      const name = cleanFoodText(part);
      if (!name) {
        return [];
      }
      if (/\bcaf[eé]\b/i.test(name)) {
        return [{ foodName: name, quantity: 1, unit: "xícara" }];
      }
      return [{ foodName: name, quantity: null, unit: null }];
    }
    const foodName = cleanFoodText(`${part.slice(0, quantity.index)} ${part.slice(quantity.index + quantity.raw.length)}`);
    return foodName
      ? [{ foodName, quantity: quantity.quantity, unit: quantity.unit }]
      : [];
  });
}

export function classifyWhatsappMessageDeterministically(text: string): WhatsappInterpretedIntent {
  const normalized = normalizeText(text);

  const replacementMatch = text.match(/\b(?:n[aã]o)\s+(?:é|e|era)\s+(.+?)\s+(?:e\s+sim|é|e|era)\s+(.+)$/i)
    ?? text.match(/\b(?:trocar|troque|troca|substituir|substitua|mudar|alterar|corrigir)\b\s+(.+?)\s+(?:por|para)\s+(.+)$/i);
  if (replacementMatch && !/\d/.test(replacementMatch[2])) {
    return {
      intent: "replace_food_in_meal",
      confidence: 0.82,
      sourceFood: cleanFoodText(replacementMatch[1]),
      targetFood: cleanFoodText(replacementMatch[2]),
      items: [],
      requiresConfirmation: false,
      possibleIntents: [],
      reason: "Correção de alimento detectada por padrão textual seguro.",
    };
  }

  const addToMealMatch = text.match(/\b(?:inclua|incluir|inclui|adicionar|adicione|adiciona|registrar|registre)\s+(?:no|na|ao|a)\s+([^:]+):\s*(.+)$/i);
  if (addToMealMatch) {
    const items = buildFoodItems(addToMealMatch[2]);
    return {
      intent: "add_foods_to_meal",
      confidence: items.length ? 0.84 : 0.6,
      meal: {
        label: addToMealMatch[1].trim(),
        createIfMissing: true,
      },
      items,
      requiresConfirmation: items.some(item => !item.quantity || !item.unit),
      clarificationQuestion: items.some(item => !item.quantity || !item.unit)
        ? "Algum alimento ficou sem quantidade. Confirmo com uma porção padrão ou você prefere informar a quantidade?"
        : null,
      possibleIntents: [],
      reason: "Mensagem pede inclusão em refeição nomeada.",
    };
  }

  if (/\b(refeicoes registradas|ver refeicoes|listar refeicoes|minhas refeicoes|meus registros|registros dos alimentos|o que comi hoje)\b/.test(normalized)) {
    return {
      intent: "list_meal_records",
      confidence: 0.88,
      items: [],
      requiresConfirmation: false,
      possibleIntents: [],
      reason: "Consulta de refeições registradas detectada.",
    };
  }

  if (/\b(resumo do dia|resumo de hoje|total de hoje|calorias de hoje)\b/.test(normalized)) {
    return {
      intent: "daily_summary",
      confidence: 0.82,
      items: [],
      requiresConfirmation: false,
      possibleIntents: [],
      reason: "Consulta de resumo diário detectada.",
    };
  }

  if (/\b(ajuda|comandos|o que posso fazer)\b/.test(normalized)) {
    return {
      intent: "help",
      confidence: 0.86,
      items: [],
      requiresConfirmation: false,
      possibleIntents: [],
    };
  }

  if (/^registro[s]?$/.test(normalized)) {
    return {
      intent: "ambiguous",
      confidence: 0.62,
      items: [],
      requiresConfirmation: true,
      clarificationQuestion: "Você quer registrar um alimento, ver refeições registradas ou abrir a tela de registros?",
      possibleIntents: ["add_foods_to_meal", "list_meal_records", "open_records_link"],
      reason: "Texto curto com múltiplas interpretações possíveis.",
    };
  }

  if (/^[\p{L}\s-]{2,60}$/u.test(text) && !/\d/.test(text)) {
    return {
      intent: "add_foods_to_meal",
      confidence: 0.55,
      items: [{ foodName: text.trim(), quantity: null, unit: null }],
      requiresConfirmation: true,
      clarificationQuestion: "Entendi o alimento, mas preciso da quantidade ou porção. Exemplo: 1 banana ou 100 g de arroz.",
      possibleIntents: ["add_foods_to_meal"],
      reason: "Provável alimento sem quantidade.",
    };
  }

  return {
    intent: "unknown",
    confidence: 0.3,
    items: [],
    requiresConfirmation: true,
    clarificationQuestion: "Não entendi com segurança. Você quer registrar alimento, corrigir uma refeição ou consultar seus registros?",
    possibleIntents: ["add_foods_to_meal", "replace_food_in_meal", "list_meal_records"],
  };
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function buildInstructions(context: WhatsappIntentContext) {
  return [
    "Voce interpreta mensagens de WhatsApp sobre controle de calorias.",
    "Retorne somente JSON compativel com o schema.",
    "Nunca execute acoes, nunca grave dados e nunca invente refeicoes ou alimentos fora da mensagem/contexto.",
    "Use baixa confianca e requiresConfirmation quando houver ambiguidade.",
    "Para consultas como 'refeicoes registradas', use list_meal_records, nao add_foods_to_meal.",
    "Para correcoes como 'nao e A e sim B', use replace_food_in_meal e remova prefixos como 'sim' do alimento destino.",
    "Para adicionar alimento a uma refeicao valida ainda inexistente, use meal.createIfMissing=true quando a mensagem contiver alimentos.",
    `Contexto seguro do usuario: ${JSON.stringify(context)}`,
  ].join("\n");
}

export async function interpretWhatsappMessage(
  text: string,
  context: WhatsappIntentContext,
  options: InterpretOptions = {},
): Promise<WhatsappInterpretedIntent> {
  if (options.useLlm === false) {
    return classifyWhatsappMessageDeterministically(text);
  }

  try {
    const response = await getAiProvider().createTextResponse({
      model: process.env.OPENAI_WHATSAPP_INTENT_MODEL ?? process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini",
      instructions: buildInstructions(context),
      input: [{ role: "user", content: [{ type: "input_text", text }] }],
      format: {
        type: "json_schema",
        name: "whatsapp_intent",
        schema: whatsappIntentJsonSchema as unknown as Record<string, unknown>,
        strict: true,
      },
    });
    const parsed = parseWhatsappInterpretedIntent(parseJson(response.outputText));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Keep WhatsApp usable when the LLM is unavailable or returns invalid JSON.
  }

  return classifyWhatsappMessageDeterministically(text);
}
