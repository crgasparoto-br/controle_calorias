import { listMeals } from "../meals/service";
import { executeWhatsappDeleteIntent } from "./deleteIntent";
import { handleFoodReplacementIntents } from "./intent/foodReplacementHandlers";
import { handleQuantityCorrectionIntent } from "./intent/gramsAdjustmentHandlers";
import { createPendingMealItemSelection } from "./mealItemSelectionCallback";
import type { WhatsAppLogicalReply } from "./replyContract";

export type WhatsappRecordAdjustmentInput = {
  text?: string | null;
  receivedAt?: Date;
  userTimezone?: string | null;
};

export type WhatsappRecordAdjustmentResult = {
  handled: true;
  action: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

type ExistingMeal = Awaited<ReturnType<typeof listMeals>>[number];
type ExistingMealItem = NonNullable<ExistingMeal["items"]>[number];

type AdjustmentIntent =
  | { kind: "quantity"; quantity: number; unit: string }
  | { kind: "replace_item"; sourceFood: string; targetFood: string }
  | { kind: "remove_item"; targetFood: string }
  | { kind: "remove_last_meal" }
  | { kind: "incomplete" };

const RECENT_ADJUSTMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectAdjustmentIntent(text: string): AdjustmentIntent | null {
  const trimmed = text.trim();
  const normalized = normalizeText(trimmed);

  if (/^(?:apaga|apagar|remove|remover|exclui|excluir)\s+(?:o\s+|a\s+)?(?:ultimo|ultima)$/.test(normalized)) {
    return { kind: "remove_last_meal" };
  }
  if (/^(?:corrige|corrigir|altera|alterar|ajusta|ajustar|troca|trocar|remove|remover|apaga|apagar|exclui|excluir)\s+(?:isso|esse|essa|ultimo|ultima)$/.test(normalized)) {
    return { kind: "incomplete" };
  }

  const quantityMatch = /^(?:era|corrige(?:\s+(?:para|pra))?|corrigir(?:\s+(?:para|pra))?|ajusta(?:\s+(?:para|pra))?|ajustar(?:\s+(?:para|pra))?)\s+(\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|ml|l|un|unidade|unidades|fatia|fatias|porcao|porcoes|porção|porções)$/iu.exec(trimmed);
  if (quantityMatch) {
    return { kind: "quantity", quantity: Number(quantityMatch[1].replace(",", ".")), unit: quantityMatch[2].toLowerCase() };
  }

  const replaceMatch = /^(?:troca|trocar|substitui|substituir|nao\s+(?:e|era)|não\s+(?:é|era))\s+(.+?)\s+(?:por|pelo|pela|e\s+sim|é|e)\s+(.+)$/iu.exec(trimmed);
  if (replaceMatch) {
    return { kind: "replace_item", sourceFood: replaceMatch[1].trim(), targetFood: replaceMatch[2].trim() };
  }

  if (/^(?:apaga|apagar|remove|remover|exclui|excluir)\s+(?:a\s+)?(?:refeicao|refeição|ultima\s+refeicao|última\s+refeição|ultimo\s+lancamento|último\s+lançamento)$/iu.test(trimmed)) {
    return { kind: "remove_last_meal" };
  }

  const removeItemMatch = /^(?:remove|remover|apaga|apagar|exclui|excluir)\s+(?:o\s+|a\s+|um\s+|uma\s+)?(.+)$/iu.exec(trimmed);
  if (removeItemMatch?.[1]?.trim()) return { kind: "remove_item", targetFood: removeItemMatch[1].trim() };
  return null;
}

function getRecentMeals(meals: ExistingMeal[], receivedAt: Date) {
  const now = receivedAt.getTime();
  return meals
    .filter(meal => {
      const occurredAt = new Date(meal.occurredAt).getTime();
      return Number.isFinite(occurredAt) && occurredAt <= now && now - occurredAt <= RECENT_ADJUSTMENT_WINDOW_MS;
    })
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

function itemName(item: ExistingMealItem) {
  return item.foodName || item.canonicalName || "item";
}

function clarification(detail: string): WhatsappRecordAdjustmentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: "Preciso saber qual item ou refeição você quer ajustar. Exemplo: troque arroz por arroz integral, ou corrija para 150 g.",
    eventType: "whatsapp.records.adjustment_clarification_needed",
    detail,
  };
}

export async function executeWhatsappRecordAdjustmentIntent(
  userId: number,
  input: WhatsappRecordAdjustmentInput,
): Promise<WhatsappRecordAdjustmentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;
  const intent = detectAdjustmentIntent(text);
  if (!intent) return null;
  if (intent.kind === "incomplete") return clarification("Comando de ajuste sem alvo suficiente.");

  if (intent.kind === "remove_item" || intent.kind === "remove_last_meal") {
    return executeWhatsappDeleteIntent(userId, { text }) as Promise<WhatsappRecordAdjustmentResult | null>;
  }

  if (intent.kind === "replace_item") {
    return handleFoodReplacementIntents(userId, [{ fromFood: intent.sourceFood, toFood: intent.targetFood }]);
  }

  const recentMeals = getRecentMeals(await listMeals(userId), input.receivedAt ?? new Date());
  const latestMeal = recentMeals[0];
  if (!latestMeal?.items?.length) return clarification("Correção de quantidade sem refeição recente disponível.");

  if (latestMeal.items.length === 1) {
    return handleQuantityCorrectionIntent(userId, {
      previousQuantity: null,
      previousUnit: null,
      nextQuantity: intent.quantity,
      nextUnit: intent.unit,
    });
  }

  const pending = await createPendingMealItemSelection(userId, {
    targetFood: "item da última refeição",
    action: { kind: "quantity_absolute", quantity: intent.quantity, unit: intent.unit },
    contextLabel: "na última refeição",
    resultTitle: "Quantidade corrigida",
    candidates: latestMeal.items.map((item, itemIndex) => ({
      mealId: latestMeal.id,
      mealLabel: latestMeal.mealLabel,
      itemIndex,
      itemName: itemName(item),
    })),
  });
  return pending;
}

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: true,
  usesSummary: false,
  usesPendingOperation: true,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
