export type SelectionCandidate = {
  mealId: number;
  mealLabel: string;
  itemIndex: number;
  itemName: string;
};

export type SelectionAction =
  | { kind: "grams_delta"; delta: number }
  | { kind: "grams_absolute"; grams: number }
  | { kind: "quantity_absolute"; quantity: number; unit: string }
  | { kind: "replace_food"; targetFood: string }
  | { kind: "mixed_increment_target"; operationIndex: number };

type SelectionCompanionAction = {
  candidate: SelectionCandidate;
  action: SelectionAction;
};

type PendingSelection = {
  targetFood: string | null;
  action: SelectionAction;
  resultTitle: string;
  candidates: SelectionCandidate[];
  companionActions?: SelectionCompanionAction[];
};

export type SelectionMealItem = {
  foodName?: string | null;
  portionText?: string | null;
  estimatedGrams?: number | string | null;
  [key: string]: unknown;
};

export type SelectionMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string | null;
  items: SelectionMealItem[];
  [key: string]: unknown;
};

type SelectionSnapshot = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string | null;
  mutationPreImage?: string;
  items: SelectionMealItem[];
};

type SelectionChange = {
  before: SelectionSnapshot;
  after: SelectionSnapshot;
};

type SelectionFailure = {
  rollbackSucceeded: boolean;
  userMessage: string;
  detail: string;
};

export type MealItemSelectionMutationBindings = {
  listMeals: (
    userId: number,
    options?: { adjustmentRead?: boolean }
  ) => Promise<SelectionMeal[]>;
  readMutationPreImage: (value: unknown) => string | null;
  scaleMealItem: (item: SelectionMealItem, grams: number) => SelectionMealItem;
  scaleMealItemQuantity: (
    item: SelectionMealItem,
    quantity: number,
    unit: string
  ) => SelectionMealItem;
  replaceMealItemFood: (
    item: SelectionMealItem,
    targetFood: string
  ) => SelectionMealItem;
  updateMealsWithCompensation: (
    userId: number,
    changes: SelectionChange[]
  ) => Promise<SelectionMeal[]>;
  describeBatchFailure: (error: unknown) => SelectionFailure;
  buildRecoverableErrorReply: (message: string) => string;
  composeActionReplies: (input: {
    userId: number;
    entries: Array<{
      meal: SelectionMeal;
      options: { title: string; actionLines: string[] };
    }>;
  }) => Promise<string>;
  normalizeCandidateName: (value: string) => string;
};

type SelectionResult = {
  handled: true;
  action:
    | "clarification_needed"
    | "meal_item_grams_adjusted"
    | "meal_item_replaced";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
};

function staleChoiceOutcome(): SelectionResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply:
      "A refeição mudou desde a seleção. Não apliquei esta tentativa; confira o estado atual antes de repetir o pedido.",
    eventType: "whatsapp.intent.meal_item_selection_stale",
    detail: "Plano de seleção obsoleto bloqueado antes da mutação.",
    data: {},
  };
}

function candidatePosition(
  meal: SelectionMeal,
  candidate: SelectionCandidate,
  normalize: (value: string) => string
) {
  const originalItem = meal.items[candidate.itemIndex];
  const candidateName = normalize(candidate.itemName);
  if (
    originalItem &&
    normalize(originalItem.foodName ?? "") === candidateName
  ) {
    return candidate.itemIndex;
  }
  const sameItems = meal.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => normalize(item.foodName ?? "") === candidateName);
  return sameItems.length === 1 ? sameItems[0].index : null;
}

function applyItemChange(
  item: SelectionMealItem,
  action: SelectionAction,
  bindings: MealItemSelectionMutationBindings
) {
  const previousGrams = Number(item.estimatedGrams || 0);
  if (action.kind === "grams_delta") {
    const nextGrams = Math.max(previousGrams + action.delta, 1);
    return {
      nextItem: bindings.scaleMealItem(item, nextGrams),
      actionLine: `${item.foodName}: de ${previousGrams} g para ${nextGrams} g`,
    };
  }
  if (action.kind === "grams_absolute") {
    const nextGrams = Math.max(action.grams, 1);
    return {
      nextItem: bindings.scaleMealItem(item, nextGrams),
      actionLine: `${item.foodName}: de ${previousGrams} g para ${nextGrams} g`,
    };
  }
  if (action.kind === "quantity_absolute") {
    const previousPortion = item.portionText ?? `${previousGrams} g`;
    const nextItem = bindings.scaleMealItemQuantity(
      item,
      action.quantity,
      action.unit
    );
    return {
      nextItem,
      actionLine: `${item.foodName}: de ${previousPortion} para ${nextItem.portionText}`,
    };
  }
  if (action.kind === "mixed_increment_target") {
    throw new Error(
      "A seleção de alvo misto não pode mutar o item diretamente."
    );
  }
  return {
    nextItem: bindings.replaceMealItemFood(item, action.targetFood),
    actionLine: `${item.foodName} → ${action.targetFood}`,
  };
}

export async function applyChoicePlan(
  userId: number,
  selected: SelectionCandidate,
  pending: PendingSelection,
  bindings: MealItemSelectionMutationBindings
): Promise<SelectionResult> {
  const meals = await bindings.listMeals(userId, { adjustmentRead: true });
  const plan: SelectionCompanionAction[] = [
    ...(pending.companionActions ?? []),
    { candidate: selected, action: pending.action },
  ];
  const workingMeals = new Map<number, SelectionMeal>();
  const actionLinesByMeal = new Map<number, string[]>();

  for (const step of plan) {
    const originalMeal = meals.find(meal => meal.id === step.candidate.mealId);
    if (!originalMeal?.items.length) return staleChoiceOutcome();
    const resolvedIndex = candidatePosition(
      originalMeal,
      step.candidate,
      bindings.normalizeCandidateName
    );
    if (resolvedIndex === null) return staleChoiceOutcome();
    const sourceMeal = workingMeals.get(step.candidate.mealId) ?? originalMeal;
    const item = sourceMeal.items[resolvedIndex];
    if (!item) return staleChoiceOutcome();
    const { nextItem, actionLine } = applyItemChange(item, step.action, bindings);
    const nextMeal = {
      ...sourceMeal,
      items: sourceMeal.items.map((existingItem, index) =>
        index === resolvedIndex ? nextItem : existingItem
      ),
    };
    workingMeals.set(nextMeal.id, nextMeal);
    actionLinesByMeal.set(nextMeal.id, [
      ...(actionLinesByMeal.get(nextMeal.id) ?? []),
      actionLine,
    ]);
  }

  const changes: SelectionChange[] = [];
  for (const meal of workingMeals.values()) {
    const before = meals.find(candidate => candidate.id === meal.id);
    if (!before?.items.length) return staleChoiceOutcome();
    changes.push({
      before: {
        id: before.id,
        mealLabel: before.mealLabel,
        occurredAt: before.occurredAt,
        notes: before.notes,
        mutationPreImage:
          bindings.readMutationPreImage(before) ?? undefined,
        items: before.items,
      },
      after: {
        id: meal.id,
        mealLabel: meal.mealLabel,
        occurredAt: meal.occurredAt,
        notes: meal.notes,
        items: meal.items,
      },
    });
  }

  let updatedMeals: SelectionMeal[];
  try {
    updatedMeals = await bindings.updateMealsWithCompensation(userId, changes);
  } catch (error) {
    const failure = bindings.describeBatchFailure(error);
    return {
      handled: true,
      action: "clarification_needed",
      reply: bindings.buildRecoverableErrorReply(failure.userMessage),
      eventType: "whatsapp.intent.meal_item_selection_batch_failed",
      detail: failure.detail,
      data: {
        rollbackSucceeded: failure.rollbackSucceeded,
        affectedMealIds: changes.map(change => change.after.id),
      },
    };
  }

  const hasReplacement = plan.some(
    step => step.action.kind === "replace_food"
  );
  const reply = await bindings.composeActionReplies({
    userId,
    entries: updatedMeals.map(meal => ({
      meal,
      options: {
        title: pending.resultTitle,
        actionLines: actionLinesByMeal.get(meal.id) ?? [],
      },
    })),
  });
  return {
    handled: true,
    action: hasReplacement ? "meal_item_replaced" : "meal_item_grams_adjusted",
    reply,
    eventType: hasReplacement
      ? "whatsapp.intent.meal_item_replaced"
      : "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${plan.length} ação(ões) aplicada(s) somente após todas as seleções, com revalidação do estado atual.`,
    data: {
      mealId: updatedMeals[0]?.id,
      affectedMealIds: updatedMeals.map(meal => meal.id),
      actionCount: plan.length,
    },
  };
}
