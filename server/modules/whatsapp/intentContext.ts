import { listMeals } from "../meals/service";
import type { MealDraftItem } from "../../nutritionEngine";
import { retrieveWhatsappContextMemory, type WhatsappMemoryRetrievalContext } from "./contextMemory";
import { createDrizzleWhatsAppConversationRepository, type WhatsAppConversationRepository } from "../../repositories/whatsappConversationRepository";
import { getDb, logPersistenceWarning } from "../../db";
import { WHATSAPP_CONVERSATION_ACTIVE_TTL_MS } from "./conversationPolicy";
import {
  CONTEXT_BUDGETS,
  getEffectiveMessageText,
  selectRecentWindow,
  type ConversationContextConsumer,
} from "./conversationContextBudget";
import { getOrRefreshConversationSummary } from "./conversationSummaryService";

const MAX_CONTEXT_MEALS = 6;
const MAX_CONTEXT_ITEMS_PER_MEAL = 8;
const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
/** Mensagens buscadas do banco antes de aplicar o orçamento — folga suficiente para janela + overflow razoável. */
const RECENT_MESSAGES_FETCH_LIMIT = 50;

const conversationRepository: WhatsAppConversationRepository = createDrizzleWhatsAppConversationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export type WhatsappIntentContext = {
  version: "whatsapp-intent-context/v2";
  nowIso: string;
  timezone: string;
  mealAliases: Record<string, string[]>;
  currentDomainSnapshot: {
    latestMeal: WhatsappContextMeal | null;
    mealsToday: WhatsappContextMeal[];
    recentFoodNames: string[];
  };
  contextualMemories: WhatsappMemoryRetrievalContext["llmContext"];
  pendingClarification: {
    kind: string;
    originalIntent?: string;
  } | null;
  /**
   * Janela recente de mensagens persistidas (usuário e assistente), dentro do
   * orçamento do consumidor. Substitui o limite fixo de 3 turnos efêmeros.
   */
  recentTurns: Array<{
    direction: "inbound" | "outbound";
    text: string | null;
    occurredAtIso: string;
  }>;
  /** Síntese do que ficou fora da janela recente, com proveniência. Nunca contém valores nutricionais/quantidades como fato atual. */
  conversationSummary: { summaryText: string; fromMessageId: number; toMessageId: number } | null;
  /** false quando a última mensagem é mais antiga que a janela de conversa ativa — referências vagas devem ser tratadas com cautela. */
  conversationActive: boolean;
  /** true quando havia mais mensagens do que o orçamento comportou (parte foi resumida ou omitida). */
  truncated: boolean;
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
    consumer?: ConversationContextConsumer;
  } = {},
): Promise<WhatsappIntentContext> {
  const receivedAt = options.receivedAt ?? new Date();
  const consumer = options.consumer ?? "intent_classifier";
  const budget = CONTEXT_BUDGETS[consumer];

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

  const persistedMessages = await conversationRepository.findRecentMessagesByUser(userId, RECENT_MESSAGES_FETCH_LIMIT);
  const { window, overflow, truncated } = selectRecentWindow(persistedMessages, budget);

  const lastMessage = persistedMessages[persistedMessages.length - 1];
  const conversationActive = Boolean(
    lastMessage && receivedAt.getTime() - new Date(lastMessage.occurredAt).getTime() < WHATSAPP_CONVERSATION_ACTIVE_TTL_MS,
  );

  let conversationSummary: WhatsappIntentContext["conversationSummary"] = null;
  if (overflow.length > 0) {
    conversationSummary = await getOrRefreshConversationSummary({
      userId,
      conversationId: overflow[0].conversationId,
      messagesBeyondWindow: overflow,
    });
  }

  return {
    version: "whatsapp-intent-context/v2",
    nowIso: receivedAt.toISOString(),
    timezone: SAO_PAULO_TIME_ZONE,
    mealAliases: {
      "café da manhã": ["cafe da manha", "café", "cafe", "manha", "manhã", "desjejum"],
      "almoço": ["almoco"],
      jantar: ["janta"],
      lanche: ["lanche da tarde", "lanche da manha", "lanche da manhã"],
      ceia: [],
    },
    currentDomainSnapshot: {
      latestMeal: compactMeals[0] ?? null,
      mealsToday,
      recentFoodNames,
    },
    contextualMemories: memoryContext.llmContext,
    pendingClarification: options.pendingClarification ?? null,
    recentTurns: window.map(message => ({
      direction: message.direction,
      text: getEffectiveMessageText(message) || null,
      occurredAtIso: new Date(message.occurredAt).toISOString(),
    })),
    conversationSummary,
    conversationActive,
    truncated,
  };
}
