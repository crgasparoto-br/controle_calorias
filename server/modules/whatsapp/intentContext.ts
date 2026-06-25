import { listMeals } from "../meals/service";
import type { MealDraftItem } from "../../nutritionEngine";
import { retrieveWhatsappContextMemory, type WhatsappMemoryRetrievalContext } from "./contextMemory";
import { getRecentConversationTurns, type ConversationTurn } from "./conversationHistory";

const MAX_CONTEXT_MEALS = 6;
const MAX_CONTEXT_ITEMS_PER_MEAL = 8;
const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

export type WhatsappIntentContext = {
  version: "whatsapp-intent-context/v1";
  nowIso: string;
  timezone: string;
  mealAliases: Record<string, string[]>;
  latestMeal: WhatsappContextMeal | null;
  mealsToday: WhatsappContextMeal[];
  recentFoodNames: string[];
  contextualMemories: WhatsappMemoryRetrievalContext["llmContext"];
  pendingClarification: {
    kind: string;
    originalIntent?: string;
  } | null;
  /**
   * Últimas trocas da conversa recente (usuário → bot).
   * Permite ao LLM resolver ambiguidades como "e o almoço?" com base no que foi dito antes.
   */
  recentConversation: Array<{
    userMessage: string;
    botReply: string | null;
  }>;
};

export type WhatsappContextMeal = {
  id: number;
  mealLabel: string;
  occurredAt: string;
  items: Array<{
    foodName: string;
    canonicalName: string;
    portionText: string;
    estimatedGrams: number;
  }>;
};

function startOfSaoPauloDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00-03:00`);
}

function sameSaoPauloDay(left: Date, right: Date) {
  return startOfSaoPauloDay(left).getTime() === startOfSaoPauloDay(right).getTime();
}

function compactMealItem(item: MealDraftItem) {
  return {
    foodName: item.foodName,
    canonicalName: item.canonicalName,
    portionText: item.portionText,
    estimatedGrams: Number(item.estimatedGrams || 0),
  };
}

function compactMeal(meal: {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  items?: MealDraftItem[];
}): WhatsappContextMeal {
  return {
    id: meal.id,
    mealLabel: meal.mealLabel,
    occurredAt: new Date(meal.occurredAt).toISOString(),
    items: (meal.items ?? []).slice(0, MAX_CONTEXT_ITEMS_PER_MEAL).map(compactMealItem),
  };
}

export async function buildWhatsappIntentContext(
  userId: number,
  options: {
    receivedAt?: Date;
    pendingClarification?: WhatsappIntentContext["pendingClarification"];
  } = {},
): Promise<WhatsappIntentContext> {
  const receivedAt = options.receivedAt ?? new Date();
  const meals = (await listMeals(userId)).slice(0, MAX_CONTEXT_MEALS);
  const compactMeals = meals.map(compactMeal);
  const mealsToday = compactMeals.filter(meal => sameSaoPauloDay(new Date(meal.occurredAt), receivedAt));
  const recentFoodNames = Array.from(new Set(
    compactMeals.flatMap(meal => meal.items.map(item => item.foodName).filter(Boolean)),
  )).slice(0, 20);
  const memoryContext = retrieveWhatsappContextMemory({
    userId,
    text: null,
    intent: null,
    now: receivedAt,
  });

  const recentTurns = getRecentConversationTurns(userId, receivedAt.getTime());

  return {
    version: "whatsapp-intent-context/v1",
    nowIso: receivedAt.toISOString(),
    timezone: SAO_PAULO_TIME_ZONE,
    mealAliases: {
      "café da manhã": ["cafe da manha", "café", "cafe", "manha", "manhã", "desjejum"],
      "almoço": ["almoco"],
      jantar: ["janta"],
      lanche: ["lanche da tarde", "lanche da manha", "lanche da manhã"],
      ceia: [],
    },
    latestMeal: compactMeals[0] ?? null,
    mealsToday,
    recentFoodNames,
    contextualMemories: memoryContext.llmContext,
    pendingClarification: options.pendingClarification ?? null,
    recentConversation: recentTurns.map(turn => ({
      userMessage: turn.userMessage,
      botReply: turn.botReply,
    })),
  };
}
