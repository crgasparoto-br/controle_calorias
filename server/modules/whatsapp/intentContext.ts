import { listMeals } from "../meals/service";
import type { MealDraftItem } from "../../nutritionEngine";
import { retrieveWhatsappContextMemory, type WhatsappMemoryRetrievalContext } from "./contextMemory";
import { createDrizzleWhatsAppConversationRepository, type WhatsAppConversationMessageRecord, type WhatsAppConversationRepository } from "../../repositories/whatsappConversationRepository";
import { getDb, logInferenceEvent, logPersistenceWarning } from "../../db";
import { WHATSAPP_CONVERSATION_ACTIVE_TTL_MS } from "./conversationPolicy";
import {
  CONTEXT_BUDGETS,
  getEffectiveMessageText,
  selectRecentWindow,
  type ConversationContextConsumer,
} from "./conversationContextBudget";
import { getOrRefreshConversationSummary } from "./conversationSummaryService";
import { getRecentConversationTurns } from "./conversationHistory";
import {
  getActiveWhatsappContextFlow,
  selectWhatsappConversationContext,
  type WhatsappContextFlow,
  type WhatsappContextReadMode,
} from "./conversationContextRollout";
import { compareWhatsappIntentInShadow, isShadowIntentComparisonEnabled } from "./shadowIntentComparison";

const MAX_CONTEXT_MEALS = 6;
const MAX_CONTEXT_ITEMS_PER_MEAL = 8;
const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const RECENT_MESSAGES_FETCH_LIMIT = 50;

const defaultConversationRepository: WhatsAppConversationRepository = createDrizzleWhatsAppConversationRepository({
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
  recentTurns: Array<{
    direction: "inbound" | "outbound";
    text: string | null;
    occurredAtIso: string;
  }>;
  conversationSummary: { summaryText: string; fromMessageId: number; toMessageId: number } | null;
  conversationActive: boolean;
  truncated: boolean;
  contextRead: {
    mode: WhatsappContextReadMode;
    flow: WhatsappContextFlow;
    source: "legacy" | "persistent";
    persistentEligible: boolean;
    equivalent: boolean | null;
    legacyCount: number;
    persistentCount: number;
  };
};

export type IntentContextUsage = {
  usesRecentWindow: boolean;
  usesSummary: boolean;
  usesPendingOperation: boolean;
  usesLongTermMemory: boolean;
  requiresFreshDbQuery: boolean;
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

function buildLegacyTurns(userId: number, receivedAt: Date) {
  return getRecentConversationTurns(userId, receivedAt.getTime()).flatMap(turn => [
    {
      direction: "inbound" as const,
      text: turn.userMessage || null,
      occurredAtIso: new Date(turn.occurredAtMs).toISOString(),
    },
    ...(turn.botReply
      ? [{
          direction: "outbound" as const,
          text: turn.botReply,
          occurredAtIso: new Date(turn.occurredAtMs).toISOString(),
        }]
      : []),
  ]);
}

function splitCurrentInboundMessage(
  messages: WhatsAppConversationMessageRecord[],
  receivedAt: Date,
) {
  const currentTimestamp = receivedAt.getTime();
  let currentIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "inbound" && new Date(message.occurredAt).getTime() === currentTimestamp) {
      currentIndex = index;
      break;
    }
  }

  return currentIndex < 0
    ? { messages, currentInbound: null }
    : {
        messages: messages.filter((_message, index) => index !== currentIndex),
        currentInbound: messages[currentIndex],
      };
}

export async function buildWhatsappIntentContext(
  userId: number,
  options: {
    receivedAt?: Date;
    pendingClarification?: WhatsappIntentContext["pendingClarification"];
    consumer?: ConversationContextConsumer;
    flow?: WhatsappContextFlow;
    conversationRepository?: WhatsAppConversationRepository;
  } = {},
): Promise<WhatsappIntentContext> {
  const receivedAt = options.receivedAt ?? new Date();
  const consumer = options.consumer ?? "intent_classifier";
  const budget = CONTEXT_BUDGETS[consumer];
  const flow = options.flow ?? getActiveWhatsappContextFlow("text");
  const conversationRepository = options.conversationRepository ?? defaultConversationRepository;

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
  const { messages: contextMessages, currentInbound } = splitCurrentInboundMessage(persistedMessages, receivedAt);
  const { window, overflow, truncated } = selectRecentWindow(contextMessages, budget);
  const persistentTurns = window.map(message => ({
    direction: message.direction,
    text: getEffectiveMessageText(message) || null,
    occurredAtIso: new Date(message.occurredAt).toISOString(),
  }));
  const legacyTurns = buildLegacyTurns(userId, receivedAt);
  const rolloutSelection = selectWhatsappConversationContext({
    userId,
    flow,
    legacyTurns,
    persistentTurns,
  });

  const lastMessage = persistedMessages[persistedMessages.length - 1];
  const conversationActive = Boolean(
    lastMessage && receivedAt.getTime() - new Date(lastMessage.occurredAt).getTime() < WHATSAPP_CONVERSATION_ACTIVE_TTL_MS,
  );

  const compareStructuredIntent = rolloutSelection.mode === "shadow"
    && rolloutSelection.persistentEligible
    && isShadowIntentComparisonEnabled();
  let persistentSummary: WhatsappIntentContext["conversationSummary"] = null;
  if (overflow.length > 0 && (rolloutSelection.source === "persistent" || compareStructuredIntent)) {
    persistentSummary = await getOrRefreshConversationSummary({
      userId,
      conversationId: overflow[0].conversationId,
      messagesBeyondWindow: overflow,
    });
  }

  const commonContext = {
    version: "whatsapp-intent-context/v2" as const,
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
    conversationActive,
    truncated,
  };
  const contextRead = {
    mode: rolloutSelection.mode,
    flow: rolloutSelection.flow,
    persistentEligible: rolloutSelection.persistentEligible,
    equivalent: rolloutSelection.equivalent,
    legacyCount: rolloutSelection.legacyCount,
    persistentCount: rolloutSelection.persistentCount,
  };
  const selectedContext: WhatsappIntentContext = {
    ...commonContext,
    recentTurns: rolloutSelection.turns,
    conversationSummary: rolloutSelection.source === "persistent" ? persistentSummary : null,
    contextRead: { ...contextRead, source: rolloutSelection.source },
  };

  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: "success",
    eventType: contextMessages.length === 0 ? "whatsapp.history.context_missing" : "whatsapp.history.context_found",
    detail: JSON.stringify({
      messageCount: contextMessages.length,
      capturedMessageCount: persistedMessages.length,
      currentInboundExcluded: Boolean(currentInbound),
      contextSource: rolloutSelection.source,
      contextMode: rolloutSelection.mode,
      contextFlow: rolloutSelection.flow,
      persistentEligible: rolloutSelection.persistentEligible,
      equivalent: rolloutSelection.equivalent,
      legacyCount: rolloutSelection.legacyCount,
      persistentCount: rolloutSelection.persistentCount,
      structuredShadowComparison: compareStructuredIntent,
      contextVersion: "whatsapp-intent-context/v2",
      conversationActive,
    }),
  });
  if (rolloutSelection.mode === "shadow" && rolloutSelection.equivalent === false) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.history.shadow_divergence",
      detail: JSON.stringify({
        flow: rolloutSelection.flow,
        legacyCount: rolloutSelection.legacyCount,
        persistentCount: rolloutSelection.persistentCount,
      }),
    });
  }
  if (truncated) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.history.context_truncated",
      detail: JSON.stringify({
        originalCount: contextMessages.length,
        truncatedCount: window.length,
        reason: "message_budget",
        flow,
      }),
    });
  }

  const currentText = currentInbound ? getEffectiveMessageText(currentInbound).trim() : "";
  if (compareStructuredIntent && currentText && persistentTurns.length > 0) {
    await compareWhatsappIntentInShadow({
      userId,
      text: currentText,
      flow,
      legacyContext: {
        ...commonContext,
        recentTurns: legacyTurns,
        conversationSummary: null,
        contextRead: { ...contextRead, source: "legacy" },
      },
      persistentContext: {
        ...commonContext,
        recentTurns: persistentTurns,
        conversationSummary: persistentSummary,
        contextRead: { ...contextRead, source: "persistent" },
      },
    });
  }

  return selectedContext;
}
