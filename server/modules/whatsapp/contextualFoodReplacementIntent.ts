import { listMeals } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import {
  createPendingMealItemSelection,
  type MealItemSelectionCompanionAction,
} from "./mealItemSelectionCallback";
import {
  describeMealBatchMutationFailure,
  updateMealsWithCompensation,
  type MealBatchMutationChange,
} from "./mealBatchMutation";
import { resolveMealItemTarget } from "./mealItemTargetMatcher";
import {
  replaceMealItemFood,
  scaleMealItemQuantity,
  toMealItemInputs,
} from "./intent/mealItemHelpers";
import { buildWhatsAppRecoverableErrorReplyMessage } from "./replyMessages";
import { composeWhatsAppMealActionReplies } from "./mealActionReplyComposer";
import { requestWhatsappLatestFoodCorrectionQuantity } from "./foodQuantityClarification";

const RECENT_REPLACEMENT_WINDOW_MS = 30 * 60 * 1000;
const RECENT_REPLACEMENT_MEAL_LIMIT = 5;

type Meal = Awaited<ReturnType<typeof listMeals>>[number];
type MutableMeal = Meal & { items: MealItemInput[] };
type FoodReplacementIntent = { fromFood: string; toFood: string };
type LatestFoodCorrectionIntent = {
  toFood: string;
  quantity?: number;
  unit?: string;
};
type ReplacementContext = "first" | "second" | "previous" | "latest" | null;
type Candidate = {
  meal: MutableMeal;
  mealIndex: number;
  item: MealItemInput;
  itemIndex: number;
};

export type WhatsappContextualFoodReplacementResult = {
  action: "meal_item_replaced" | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  interactiveReply?: import("./replyContract").WhatsAppLogicalReply;
  data?: Record<string, unknown>;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cleanFood(value?: string) {
  return (
    value
      ?.replace(/\b(?:ontem|hoje|agora|por favor|pfv)\b/gi, "")
      .replace(
        /\b(?:na|no|da|do|em)\s+(?:primeira|segunda|ultima|última)\s+(?:imagem|foto)\b/gi,
        ""
      )
      .replace(/\b(?:na|no|da|do|em)\s+(?:imagem|foto)\s+anterior\b/gi, "")
      .replace(/[.,;:!?]+$/g, "")
      .replace(/^\b(?:o|a|os|as|do|da|de|dos|das)\b\s+/i, "")
      .trim() || null
  );
}

function parseReplacement(segment: string): FoodReplacementIntent | null {
  const correction = segment.match(
    /\b(?:n[aã]o)\s+(?:é|e|era)\s+(.+?)\s+(?:é|e|era)\s+(.+)$/i
  );
  const swap = segment.match(
    /\b(?:trocar|troque|troca|mudar|alterar|corrigir|substituir|substitua)\b\s+(.+?)\s+(?:por|para)\s+(.+)$/i
  );
  const match = correction || swap;
  if (!match) return null;
  const fromFood = cleanFood(match[1]);
  const toFood = cleanFood(match[2]);
  return fromFood && toFood && !/\d/.test(toFood) ? { fromFood, toFood } : null;
}

function parseReplacements(text: string) {
  const segments = text.split(/\s*[,;]\s*(?=n[aã]o\b)|\s+e\s+(?=n[aã]o\b)/i);
  const replacements = segments
    .map(segment => parseReplacement(segment.trim()))
    .filter((value): value is FoodReplacementIntent => Boolean(value));
  return replacements.length ? replacements : null;
}

export function parseLatestFoodCorrection(
  text: string
): LatestFoodCorrectionIntent | null {
  const latestMatch =
    text.match(
      /\b(?:o|a)?\s*(?:[úu]ltimo|[úu]ltima)\s+(?:alimento|item|refei[cç][aã]o)\s+(?:é|e|era|deve ser|corrigir para|substituir por)\s+(.+)$/i
    ) ??
    text.match(
      /\b(?:substituir|trocar|corrigir)\s+(?:o|a)?\s*(?:[úu]ltimo|[úu]ltima)\s+(?:alimento|item)\s+(?:por|para)\s+(.+)$/i
    );
  if (!latestMatch) return null;

  let target = cleanFood(
    latestMatch[1]
      .replace(/\b(?:substituir|trocar|corrigir|corrija|troque)\b/gi, "")
      .replace(
        /\b(?:o|a)?\s*(?:[úu]ltimo|[úu]ltima)\s+(?:alimento|item|refei[cç][aã]o)\b/gi,
        ""
      )
  );
  if (!target) return null;

  const quantityMatch = target.match(
    /^(\d+(?:[,.]\d+)?)\s*(g|gramas?|kg|ml|m\s*l|l|litros?)\b\s*(.+)$/i
  );
  if (!quantityMatch) {
    return { toFood: target };
  }

  const quantity = Number(quantityMatch[1].replace(",", "."));
  const unit = quantityMatch[2].replace(/\s+/g, "").toLowerCase();
  target = cleanFood(quantityMatch[3]);
  return target && Number.isFinite(quantity) && quantity > 0
    ? { toFood: target, quantity, unit }
    : null;
}

function parseContext(text: string): ReplacementContext {
  const value = normalize(text);
  if (/\bprimeir[ao]\s+(?:imagem|foto)\b/.test(value)) return "first";
  if (/\bsegund[ao]\s+(?:imagem|foto)\b/.test(value)) return "second";
  if (/\b(?:imagem|foto)\s+anterior\b/.test(value)) return "previous";
  if (/\b(?:ultima|ultimo|mais recente)\s+(?:imagem|foto)\b/.test(value))
    return "latest";
  return null;
}

function recentMeals(
  meals: Meal[],
  receivedAt: Date,
  context: ReplacementContext
): MutableMeal[] {
  const receivedTime = receivedAt.getTime();
  const sorted = meals
    .filter(meal => (meal.items?.length ?? 0) > 0)
    .filter(meal => !meal.source || meal.source === "whatsapp")
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime()
    );
  const insideWindow = sorted.filter(meal => {
    const occurredAt = new Date(meal.occurredAt).getTime();
    return (
      occurredAt <= receivedTime + 60_000 &&
      occurredAt >= receivedTime - RECENT_REPLACEMENT_WINDOW_MS
    );
  });
  const selected = (insideWindow.length ? insideWindow : sorted).slice(
    0,
    RECENT_REPLACEMENT_MEAL_LIMIT
  );
  const mutable = selected.map(meal => ({
    ...meal,
    items: toMealItemInputs(meal.items),
  }));
  if (!context) return mutable;
  const ascending = [...mutable].sort(
    (left, right) =>
      new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime()
  );
  const meal =
    context === "first"
      ? ascending[0]
      : context === "second"
        ? ascending[1]
        : context === "previous"
          ? mutable[1]
          : mutable[0];
  return meal ? [meal] : [];
}

function findCandidates(meals: MutableMeal[], targetFood: string): Candidate[] {
  return meals.flatMap((meal, mealIndex) => {
    const target = resolveMealItemTarget(meal.items, targetFood);
    if (target.kind === "matched")
      return [{ meal, mealIndex, item: target.item, itemIndex: target.index }];
    if (target.kind === "ambiguous")
      return target.candidates.map(candidate => ({
        meal,
        mealIndex,
        item: candidate.item,
        itemIndex: candidate.index,
      }));
    return [];
  });
}

function selectionCandidate(candidate: Candidate) {
  return {
    mealId: candidate.meal.id,
    mealLabel: candidate.meal.mealLabel,
    itemIndex: candidate.itemIndex,
    itemName: candidate.item.foodName,
  };
}

function toBatchSnapshot(meal: MutableMeal) {
  return {
    id: meal.id,
    mealLabel: meal.mealLabel,
    occurredAt: meal.occurredAt,
    notes: meal.notes,
    items: meal.items.map(item => ({ ...item })),
  };
}

export async function executeWhatsappContextualFoodReplacementIntent(
  userId: number,
  input: { text?: string | null; receivedAt?: Date }
): Promise<WhatsappContextualFoodReplacementResult | null> {
  const text = input.text?.trim();
  if (!text) return null;
  const replacements = parseReplacements(text);
  const latestCorrection = replacements
    ? null
    : parseLatestFoodCorrection(text);
  if (!replacements && !latestCorrection) return null;

  const meals = recentMeals(
    await listMeals(userId),
    input.receivedAt ?? new Date(),
    parseContext(text)
  );
  if (!meals.length) {
    return {
      action: "clarification_needed",
      reply:
        "Não encontrei uma refeição recente do WhatsApp para corrigir. Me diga qual refeição devo ajustar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição sem refeição recente disponível.",
    };
  }
  const originalMeals = new Map(
    meals.map(meal => [meal.id, toBatchSnapshot(meal)])
  );

  if (latestCorrection) {
    const latestMeal = meals[0];
    const itemIndex = latestMeal.items.length - 1;
    if (itemIndex < 0) {
      return {
        action: "clarification_needed",
        reply:
          "Não encontrei um alimento recente para corrigir. Me diga qual refeição devo ajustar.",
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido de correção do último alimento sem item disponível.",
      };
    }

    const previousItem = latestMeal.items[itemIndex];
    if (!latestCorrection.quantity) {
      const clarification = await requestWhatsappLatestFoodCorrectionQuantity({
        userId,
        mealId: latestMeal.id,
        itemIndex,
        originalFoodName: previousItem.foodName,
        replacementFoodName: latestCorrection.toFood,
        receivedAt: input.receivedAt,
      });
      return {
        action: "clarification_needed",
        reply: clarification.reply,
        eventType: clarification.eventType,
        detail: clarification.detail,
        ...(clarification.data ? { data: clarification.data } : {}),
      };
    }

    const replacementItem = scaleMealItemQuantity(
      replaceMealItemFood(previousItem, latestCorrection.toFood),
      latestCorrection.quantity,
      latestCorrection.unit ?? "g"
    );
    latestMeal.items = latestMeal.items.map((item, index) =>
      index === itemIndex ? replacementItem : item
    );

    let updatedMeals: Awaited<ReturnType<typeof updateMealsWithCompensation>>;
    try {
      updatedMeals = await updateMealsWithCompensation(userId, [
        {
          before:
            originalMeals.get(latestMeal.id) ?? toBatchSnapshot(latestMeal),
          after: toBatchSnapshot(latestMeal),
        },
      ]);
    } catch (error) {
      const failure = describeMealBatchMutationFailure(error);
      return {
        action: "clarification_needed",
        reply: buildWhatsAppRecoverableErrorReplyMessage(failure.userMessage),
        eventType: "whatsapp.intent.contextual_replacement_batch_failed",
        detail: failure.detail,
        data: {
          rollbackSucceeded: failure.rollbackSucceeded,
          affectedMealIds: [latestMeal.id],
        },
      };
    }

    const canonicalReply = await composeWhatsAppMealActionReplies({
      userId,
      entries: updatedMeals.map(meal => ({
        meal,
        options: {
          title: "Alimento substituído",
          actionLines: [
            `${previousItem.foodName} → ${latestCorrection.toFood}`,
          ],
        },
      })),
    });
    return {
      action: "meal_item_replaced",
      reply: canonicalReply,
      eventType: "whatsapp.intent.meal_item_replaced",
      detail: "Último alimento substituído com estado atual recarregado.",
      data: {
        mealId: updatedMeals[0]?.id,
        mealIds: updatedMeals.map(meal => meal.id),
      },
    };
  }

  const explicitReplacements = replacements ?? [];
  const clearActions: Array<{
    candidate: Candidate;
    replacement: FoodReplacementIntent;
  }> = [];
  const ambiguousActions: Array<{
    candidates: Candidate[];
    replacement: FoodReplacementIntent;
  }> = [];
  const notFound: string[] = [];

  for (const replacement of explicitReplacements) {
    const candidates = findCandidates(meals, replacement.fromFood);
    if (!candidates.length) notFound.push(replacement.fromFood);
    else if (candidates.length > 1)
      ambiguousActions.push({ candidates, replacement });
    else clearActions.push({ candidate: candidates[0], replacement });
  }

  if (ambiguousActions.length) {
    const [current, ...remaining] = ambiguousActions;
    const companionActions: MealItemSelectionCompanionAction[] =
      clearActions.map(clear => ({
        candidate: selectionCandidate(clear.candidate),
        action: { kind: "replace_food", targetFood: clear.replacement.toFood },
      }));
    const pending = await createPendingMealItemSelection(userId, {
      targetFood: current.replacement.fromFood,
      action: { kind: "replace_food", targetFood: current.replacement.toFood },
      contextLabel: "nas refeições recentes",
      resultTitle:
        explicitReplacements.length === 1
          ? "Alimento substituído"
          : "Alimentos substituídos",
      candidates: current.candidates.map(selectionCandidate),
      companionActions,
      remainingSelections: remaining.map(entry => ({
        targetFood: entry.replacement.fromFood,
        action: { kind: "replace_food", targetFood: entry.replacement.toFood },
        contextLabel: "nas refeições recentes",
        candidates: entry.candidates.map(selectionCandidate),
      })),
    });
    return { ...pending, action: "clarification_needed" };
  }

  if (!clearActions.length) {
    return {
      action: "clarification_needed",
      reply: `Não encontrei ${notFound.join(", ") || "esse alimento"} nas refeições recentes.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição sem alimento compatível.",
    };
  }

  const changedMealIds = new Set<number>();
  const actionLinesByMeal = new Map<number, string[]>();
  for (const clear of clearActions) {
    const { candidate, replacement } = clear;
    const replacementItem = replaceMealItemFood(
      candidate.meal.items[candidate.itemIndex],
      replacement.toFood
    );
    candidate.meal.items = candidate.meal.items.map((item, index) =>
      index === candidate.itemIndex ? replacementItem : item
    );
    changedMealIds.add(candidate.meal.id);
    actionLinesByMeal.set(candidate.meal.id, [
      ...(actionLinesByMeal.get(candidate.meal.id) ?? []),
      `${candidate.item.foodName} → ${replacement.toFood}`,
    ]);
  }

  const changedMeals = meals.filter(candidate =>
    changedMealIds.has(candidate.id)
  );
  const changes: MealBatchMutationChange[] = changedMeals.map(meal => ({
    before: originalMeals.get(meal.id) ?? toBatchSnapshot(meal),
    after: toBatchSnapshot(meal),
  }));

  let updatedMeals: Awaited<ReturnType<typeof updateMealsWithCompensation>>;
  try {
    updatedMeals = await updateMealsWithCompensation(userId, changes);
  } catch (error) {
    const failure = describeMealBatchMutationFailure(error);
    return {
      action: "clarification_needed",
      reply: buildWhatsAppRecoverableErrorReplyMessage(failure.userMessage),
      eventType: "whatsapp.intent.contextual_replacement_batch_failed",
      detail: failure.detail,
      data: {
        rollbackSucceeded: failure.rollbackSucceeded,
        affectedMealIds: changes.map(change => change.after.id),
      },
    };
  }

  const title =
    clearActions.length === 1
      ? "Alimento substituído"
      : "Alimentos substituídos";
  const canonicalReply = await composeWhatsAppMealActionReplies({
    userId,
    entries: updatedMeals.map(meal => ({
      meal,
      options: { title, actionLines: actionLinesByMeal.get(meal.id) ?? [] },
    })),
  });
  const reply =
    canonicalReply +
    (notFound.length ? `\n\nNão encontrei: ${notFound.join(", ")}.` : "");
  return {
    action: "meal_item_replaced",
    reply,
    eventType: "whatsapp.intent.meal_item_replaced",
    detail: `${clearActions.length} alimento(s) substituído(s) com estado atual recarregado.`,
    data: {
      mealId: updatedMeals[0]?.id,
      mealIds: updatedMeals.map(meal => meal.id),
    },
  };
}

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: true,
  usesSummary: false,
  usesPendingOperation: true,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
