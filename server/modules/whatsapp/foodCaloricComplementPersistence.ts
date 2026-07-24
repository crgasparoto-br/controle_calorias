import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { appendSugarQuantityToCoffeeText } from "../../coffeeSugarNutrition";
import { isCoffeeWithAddedSugar } from "../../foodSemanticCompatibility";
import { normalizeText } from "../../mealTextParsing";
import type { MealDraftItem } from "../../nutritionEngineTypes";
import type { MealItemInput } from "../meals/schemas";
import {
  buildFoodClarificationActions,
  buildFoodClarificationPendingData,
  buildPendingFoodClarificationTarget,
  PENDING_FOOD_CLARIFICATION_ORIGIN,
  PENDING_FOOD_CLARIFICATION_TTL_MS,
  PENDING_FOOD_CLARIFICATION_TYPE,
  type FoodClarificationCandidate,
} from "./foodClarificationContract";
import type {
  CaloricComplementQuantityContext,
  FoodQuantityClarificationTarget,
} from "./foodQuantityClarification";
import type { FoodClarificationDependencies } from "./foodClarificationPersistence";
import type { WhatsappIntentResult } from "./intent/types";
import { replaceMealItemFood, toMealItemInputs } from "./intent/mealItemHelpers";
import { resolveTargetMealItemInMeals } from "./intent/mealTargetResolution";
import {
  composeWhatsAppMealActionReply,
  composeWhatsAppMealActionReplies,
} from "./mealActionReplyComposer";
import { consolidateWhatsAppMealAfterSave } from "./mealConsolidationService";
import {
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";

const SUGAR_QUANTITY_INSTRUCTION =
  "Informe somente a quantidade de açúcar em gramas. Exemplo: 5 g. Não vou assumir uma quantidade padrão.";

type ExistingMeal = Awaited<
  ReturnType<FoodClarificationDependencies["listMeals"]>
>[number];

type MutableMeal = Omit<ExistingMeal, "items"> & { items: MealItemInput[] };

type MealSnapshot = {
  id: number;
  mealLabel: string;
  occurredAt: string;
  notes: string | undefined;
  items: MealItemInput[];
};

type BatchReplacementLine = {
  fromFood: string;
  toFood: string;
};

function sameLogicalMeal(
  meal: ExistingMeal,
  mealLabel: string,
  occurredAt: Date,
  timeZone: string,
) {
  return normalizeText(meal.mealLabel) === normalizeText(mealLabel)
    && getDateKeyInTimeZone(new Date(meal.occurredAt), timeZone)
      === getDateKeyInTimeZone(occurredAt, timeZone);
}

function assertCoherentSweetenedCoffee(item: MealDraftItem | undefined) {
  if (!item) throw new Error("A quantidade de açúcar não produziu um alimento válido.");
  if (/sem\s+açúcar/i.test(item.canonicalName)) {
    throw new Error("A composição resolvida contradiz o complemento informado.");
  }
  if (item.calories <= 2 || item.carbs <= 0) {
    throw new Error("A composição resolvida não incorporou o açúcar.");
  }
  return item;
}

function findResolvedSweetenedCoffee(items: MealDraftItem[]) {
  const matches = items.filter(item =>
    isCoffeeWithAddedSugar(`${item.foodName} ${item.canonicalName}`)
  );
  if (!matches.length) {
    throw new Error("A clarificação de açúcar não identificou café adoçado.");
  }
  matches.forEach(assertCoherentSweetenedCoffee);
  return matches[0];
}

function isSugarQuantityRequired(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    context?: { component?: unknown };
  };
  return candidate.code === "food_component_quantity_required"
    && candidate.context?.component === "açúcar";
}

function buildCaloricComplementCandidate(): FoodClarificationCandidate {
  return {
    name: "Café com açúcar",
    servingLabel: "quantidade informada pelo usuário",
    gramsPerServing: 0,
    brandName: null,
    isBrandedProduct: false,
    matchKind: "exact",
  };
}

async function requestNextSugarQuantity(input: {
  deps: FoodClarificationDependencies;
  userId: number;
  context: CaloricComplementQuantityContext;
  resolvedFoodText: string;
  explicitQuantity: { quantity: number; unit: string };
  receivedAt: Date;
}): Promise<WhatsappIntentResult> {
  const candidate = buildCaloricComplementCandidate();
  const originalText = input.context.originalText?.trim()
    || input.context.originalFoodText;
  const nextContext: CaloricComplementQuantityContext = {
    ...input.context,
    originalFoodText: input.resolvedFoodText,
    originalText,
    completedComponents: [
      ...(input.context.completedComponents ?? []),
      {
        componentName: "açúcar",
        quantity: input.explicitQuantity.quantity,
        unit: input.explicitQuantity.unit,
      },
    ],
  };
  const baseTarget = buildPendingFoodClarificationTarget({
    request: {
      originalText,
      originalCandidate: "Café com açúcar",
      normalizedCandidate: "Café com açúcar",
      normalizationChanged: false,
      count: 1,
    },
    pendingKind: "quantity",
    candidates: [candidate],
    selectedCandidateIndex: 0,
    instructionText: SUGAR_QUANTITY_INSTRUCTION,
    messageId: input.context.inboundMessageId,
  });
  const target: FoodQuantityClarificationTarget = {
    ...baseTarget,
    actions: buildFoodClarificationActions("quantity", [candidate]),
    allowedDomainEffect: "complete_pending_food_operation_once",
    resolutionContext: nextContext,
  };
  const created = await input.deps.repository.createPendingOperation({
    userId: input.userId,
    type: PENDING_FOOD_CLARIFICATION_TYPE,
    origin: PENDING_FOOD_CLARIFICATION_ORIGIN,
    target,
    ttlMs: PENDING_FOOD_CLARIFICATION_TTL_MS,
    now: input.receivedAt,
  });

  if (!created) {
    return {
      handled: true,
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui guardar a próxima quantidade de açúcar com segurança. Nenhuma refeição foi alterada; envie a descrição completa novamente."
      ),
      eventType: "whatsapp.food_clarification.persistence_unavailable",
      detail:
        "A continuação de múltiplos cafés adoçados não foi persistida antes do outbound.",
      data: {
        completedComponentCount: nextContext.completedComponents?.length ?? 0,
        retryRequiresFullMessage: true,
      },
    };
  }

  return {
    handled: true,
    action: "food_clarification_requested",
    reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
    eventType: "whatsapp.food_clarification.next_component_requested",
    detail:
      "A quantidade anterior foi preservada no estado persistido e o próximo café adoçado aguarda sua própria quantidade.",
    data: {
      ...buildFoodClarificationPendingData(created, target),
      completedComponentCount: nextContext.completedComponents?.length ?? 0,
    },
  };
}

async function processResolvedFood(
  deps: FoodClarificationDependencies,
  userId: number,
  resolvedFoodText: string,
  occurredAt: Date,
  timeZone: string,
) {
  const processed = await deps.processFood({
    text: resolvedFoodText,
    habits: await deps.getHabits(userId),
    occurredAt,
    timeZone,
  });
  const resolvedItems = toMealItemInputs(processed.items);
  const resolvedItem = toMealItemInputs([
    findResolvedSweetenedCoffee(processed.items),
  ])[0];
  return {
    processed,
    resolvedItems,
    resolvedItem,
  };
}

function buildCompletedActionLine(input: {
  action: "register" | "add";
  itemCount: number;
  resolvedItem: MealItemInput;
  explicitQuantity: { quantity: number; unit: string };
}) {
  const verb = input.action === "register" ? "Registrei" : "Adicionei";
  if (input.itemCount === 1) {
    return `${verb} ${input.resolvedItem.foodName} com ${input.explicitQuantity.quantity} ${input.explicitQuantity.unit} de açúcar.`;
  }
  return `${verb} ${input.itemCount} alimentos, incluindo ${input.resolvedItem.foodName} com ${input.explicitQuantity.quantity} ${input.explicitQuantity.unit} de açúcar.`;
}

async function buildReply(input: {
  userId: number;
  meal: ExistingMeal;
  timeZone: string;
  title: string;
  actionLine: string;
  state: "registered" | "updated";
}) {
  return composeWhatsAppMealActionReply({
    userId: input.userId,
    meal: input.meal,
    timeZone: input.timeZone,
    options: {
      title: input.title,
      actionLines: [input.actionLine],
      mealResultState: input.state,
    },
  });
}

function toMutableMeals(meals: ExistingMeal[]): MutableMeal[] {
  return meals.map(meal => ({
    ...meal,
    items: toMealItemInputs(meal.items as MealDraftItem[] | undefined),
  }));
}

function toSnapshot(meal: ExistingMeal | MutableMeal): MealSnapshot {
  return {
    id: meal.id,
    mealLabel: meal.mealLabel,
    occurredAt: new Date(meal.occurredAt).toISOString(),
    notes: meal.notes ?? undefined,
    items: toMealItemInputs(meal.items as MealDraftItem[] | undefined),
  };
}

async function updateReplacementBatchWithCompensation(input: {
  deps: FoodClarificationDependencies;
  userId: number;
  changes: Array<{ before: MealSnapshot; after: MealSnapshot }>;
}) {
  const attempted: Array<{ before: MealSnapshot; after: MealSnapshot }> = [];
  try {
    for (const change of input.changes) {
      attempted.push(change);
      await input.deps.updateMeal(input.userId, {
        mealId: change.after.id,
        mealLabel: change.after.mealLabel,
        occurredAt: change.after.occurredAt,
        notes: change.after.notes,
        items: change.after.items,
      });
    }
  } catch {
    let rollbackFailed = false;
    for (const change of [...attempted].reverse()) {
      try {
        await input.deps.updateMeal(input.userId, {
          mealId: change.before.id,
          mealLabel: change.before.mealLabel,
          occurredAt: change.before.occurredAt,
          notes: change.before.notes,
          items: change.before.items,
        });
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) {
      throw new Error("Falha na substituição composta com rollback incompleto; o estado deve ser verificado.");
    }
    throw new Error("Falha na substituição composta; as alterações anteriores foram revertidas.");
  }
}

function applyReplacementBatch(input: {
  meals: ExistingMeal[];
  primaryMealId: number;
  primaryItemIndex: number;
  primaryOriginalFoodName: string;
  primaryResolvedItem: MealItemInput;
  companions: Array<{ fromFood: string; toFood: string }>;
  timeZone: string;
}) {
  const mutableMeals = toMutableMeals(input.meals);
  const changedMealIndexes = new Set<number>();
  const lines: BatchReplacementLine[] = [];
  const primaryMealIndex = mutableMeals.findIndex(meal => meal.id === input.primaryMealId);
  const primaryMeal = mutableMeals[primaryMealIndex];
  const primaryItem = primaryMeal?.items[input.primaryItemIndex];
  if (!primaryMeal || !primaryItem) {
    throw new Error("A refeição ou o item-alvo já não está disponível.");
  }
  const expectedName = normalizeText(input.primaryOriginalFoodName);
  if (![primaryItem.foodName, primaryItem.canonicalName]
    .map(value => normalizeText(value ?? ""))
    .includes(expectedName)) {
    throw new Error("O item-alvo mudou antes da conclusão da substituição.");
  }

  primaryMeal.items = primaryMeal.items.map((item, index) =>
    index === input.primaryItemIndex ? input.primaryResolvedItem : item,
  );
  changedMealIndexes.add(primaryMealIndex);
  lines.push({
    fromFood: primaryItem.foodName,
    toFood: input.primaryResolvedItem.foodName,
  });

  for (const companion of input.companions) {
    if (isCoffeeWithAddedSugar(companion.toFood)) {
      throw new Error("Uma segunda substituição por café adoçado exige clarificação própria.");
    }
    const target = resolveTargetMealItemInMeals(
      mutableMeals,
      companion.fromFood,
      input.timeZone,
    );
    if (target.kind !== "matched") {
      throw new Error(
        target.kind === "ambiguous"
          ? `A substituição companheira de ${companion.fromFood} ficou ambígua.`
          : `O alimento companheiro ${companion.fromFood} já não está disponível.`,
      );
    }
    const replacementItem = replaceMealItemFood(target.item, companion.toFood);
    target.meal.items = target.meal.items.map((item, index) =>
      index === target.index ? replacementItem : item,
    );
    changedMealIndexes.add(target.mealIndex);
    lines.push({
      fromFood: target.item.foodName,
      toFood: replacementItem.foodName,
    });
  }

  const changes = [...changedMealIndexes].map(index => ({
    before: toSnapshot(input.meals[index]),
    after: toSnapshot(mutableMeals[index]),
  }));
  return { changes, lines };
}

async function persistReplacementBatch(input: {
  deps: FoodClarificationDependencies;
  userId: number;
  meals: ExistingMeal[];
  operation: Extract<CaloricComplementQuantityContext["operation"], { kind: "replace_item" }>;
  resolvedItem: MealItemInput;
  explicitQuantity: { quantity: number; unit: string };
  timeZone: string;
}) {
  const batch = applyReplacementBatch({
    meals: input.meals,
    primaryMealId: input.operation.mealId,
    primaryItemIndex: input.operation.itemIndex,
    primaryOriginalFoodName: input.operation.originalFoodName,
    primaryResolvedItem: input.resolvedItem,
    companions: input.operation.companionReplacements ?? [],
    timeZone: input.timeZone,
  });
  await updateReplacementBatchWithCompensation({
    deps: input.deps,
    userId: input.userId,
    changes: batch.changes,
  });

  const reloadedMeals = await input.deps.listMeals(input.userId);
  const affectedIds = batch.changes.map(change => change.after.id);
  const affectedMeals = affectedIds
    .map(id => reloadedMeals.find(meal => meal.id === id))
    .filter((meal): meal is ExistingMeal => Boolean(meal));
  if (affectedMeals.length !== affectedIds.length) {
    throw new Error("Nem todas as refeições substituídas puderam ser recarregadas.");
  }

  const actionLines = batch.lines.map(line =>
    `${line.fromFood} → ${line.toFood}${line.toFood === input.resolvedItem.foodName
      ? ` com ${input.explicitQuantity.quantity} ${input.explicitQuantity.unit} de açúcar`
      : ""}.`
  );
  const reply = affectedMeals.length === 1
    ? await buildReply({
        userId: input.userId,
        meal: affectedMeals[0],
        timeZone: input.timeZone,
        title: batch.lines.length === 1 ? "Alimento substituído" : "Alimentos substituídos",
        actionLine: actionLines.join(" "),
        state: "updated",
      })
    : await composeWhatsAppMealActionReplies({
        userId: input.userId,
        timeZone: input.timeZone,
        entries: affectedMeals.map(meal => ({
          meal,
          options: {
            title: "Alimentos substituídos",
            actionLines,
            mealResultState: "updated" as const,
          },
        })),
      });

  return {
    handled: true,
    action: "food_clarification_completed",
    reply,
    eventType: "whatsapp.food_clarification.completed",
    detail: `${batch.lines.length} substituição(ões) concluída(s) atomicamente após clarificação e revalidação dos alvos.`,
    data: {
      mealId: input.operation.mealId,
      affectedMealIds: affectedIds,
      correctedItemIndex: input.operation.itemIndex,
      component: "açúcar",
      replacementCount: batch.lines.length,
    },
  } satisfies WhatsappIntentResult;
}

export async function persistResolvedCaloricComplement(
  deps: FoodClarificationDependencies,
  userId: number,
  context: CaloricComplementQuantityContext,
  explicitQuantity: { quantity: number; unit: string } | undefined,
  receivedAt: Date,
  timeZone: string,
): Promise<WhatsappIntentResult> {
  if (!explicitQuantity) {
    throw new Error("A quantidade do complemento não foi informada.");
  }

  const operation = context.operation;
  const operationOccurredAt = operation.kind === "register"
    ? new Date(operation.occurredAt)
    : receivedAt;
  const resolvedFoodText = appendSugarQuantityToCoffeeText(
    context.originalFoodText,
    explicitQuantity.quantity,
    explicitQuantity.unit,
  );

  let resolution: Awaited<ReturnType<typeof processResolvedFood>>;
  try {
    resolution = await processResolvedFood(
      deps,
      userId,
      resolvedFoodText,
      operationOccurredAt,
      timeZone,
    );
  } catch (error) {
    if (isSugarQuantityRequired(error)) {
      return requestNextSugarQuantity({
        deps,
        userId,
        context,
        resolvedFoodText,
        explicitQuantity,
        receivedAt,
      });
    }
    throw error;
  }
  const { processed, resolvedItems, resolvedItem } = resolution;
  const originalNotes = context.originalText?.trim() || context.originalFoodText;

  if (operation.kind === "register") {
    const meals = await deps.listMeals(userId);
    const existing = meals.find(meal =>
      sameLogicalMeal(
        meal,
        processed.detectedMealLabel || "Refeição",
        operationOccurredAt,
        timeZone,
      ),
    );
    const saved = existing
      ? await deps.updateMeal(userId, {
          mealId: existing.id,
          mealLabel: existing.mealLabel,
          occurredAt: new Date(existing.occurredAt).toISOString(),
          notes: existing.notes || originalNotes,
          items: [
            ...toMealItemInputs(existing.items as MealDraftItem[] | undefined),
            ...resolvedItems,
          ],
        })
      : await deps.createMeal(userId, {
          mealLabel: processed.detectedMealLabel || "Refeição",
          occurredAt: operationOccurredAt.toISOString(),
          notes: originalNotes,
          items: resolvedItems,
        });
    const consolidated = existing
      ? { action: "updated" as const, meal: saved }
      : await consolidateWhatsAppMealAfterSave(
          {
            listUserMeals: deps.listMeals,
            updateUserMeal: input =>
              deps.updateMeal(input.userId, {
                mealId: input.mealId,
                mealLabel: input.mealLabel,
                occurredAt: input.occurredAt,
                notes: input.notes,
                items: input.items,
              }),
            removeUserMeal: deps.removeMeal,
          },
          saved,
          timeZone,
        );
    const reloaded = (await deps.listMeals(userId)).find(
      meal => meal.id === consolidated.meal.id,
    );
    if (!reloaded) {
      throw new Error("A refeição registrada não pôde ser recarregada.");
    }

    return {
      handled: true,
      action: "food_clarification_completed",
      reply: await buildReply({
        userId,
        meal: reloaded,
        timeZone,
        title: consolidated.action === "updated"
          ? resolvedItems.length === 1 ? "Alimento adicionado" : "Alimentos adicionados"
          : "Refeição registrada",
        actionLine: buildCompletedActionLine({
          action: "register",
          itemCount: resolvedItems.length,
          resolvedItem,
          explicitQuantity,
        }),
        state: consolidated.action === "updated" ? "updated" : "registered",
      }),
      eventType: "whatsapp.food_clarification.completed",
      detail: "Registro do lote alimentar com café adoçado concluído após clarificação persistente e recarga do estado.",
      data: {
        mealId: reloaded.id,
        component: context.componentName,
        resolvedItemCount: resolvedItems.length,
        completedComponentCount: (context.completedComponents?.length ?? 0) + 1,
      },
    };
  }

  const meals = await deps.listMeals(userId);
  const currentMeal = meals.find(meal => meal.id === operation.mealId);
  if (!currentMeal) throw new Error("A refeição-alvo já não está disponível.");

  if (operation.kind === "add_to_meal") {
    if (
      normalizeText(currentMeal.mealLabel)
        !== normalizeText(operation.expectedMealLabel)
      || new Date(currentMeal.occurredAt).toISOString()
        !== operation.expectedOccurredAt
    ) {
      throw new Error("A refeição-alvo mudou antes da conclusão da adição.");
    }
    await deps.updateMeal(userId, {
      mealId: currentMeal.id,
      mealLabel: currentMeal.mealLabel,
      occurredAt: new Date(currentMeal.occurredAt).toISOString(),
      notes: currentMeal.notes,
      items: [
        ...toMealItemInputs(currentMeal.items as MealDraftItem[] | undefined),
        ...resolvedItems,
      ],
    });
    const reloaded = (await deps.listMeals(userId)).find(
      meal => meal.id === currentMeal.id,
    );
    if (!reloaded) throw new Error("A refeição atualizada não pôde ser recarregada.");

    return {
      handled: true,
      action: "food_clarification_completed",
      reply: await buildReply({
        userId,
        meal: reloaded,
        timeZone,
        title: resolvedItems.length === 1 ? "Alimento adicionado" : "Alimentos adicionados",
        actionLine: buildCompletedActionLine({
          action: "add",
          itemCount: resolvedItems.length,
          resolvedItem,
          explicitQuantity,
        }),
        state: "updated",
      }),
      eventType: "whatsapp.food_clarification.completed",
      detail: "Adição do lote alimentar com café adoçado concluída após revalidação da refeição-alvo.",
      data: {
        mealId: reloaded.id,
        component: context.componentName,
        resolvedItemCount: resolvedItems.length,
        completedComponentCount: (context.completedComponents?.length ?? 0) + 1,
      },
    };
  }

  return persistReplacementBatch({
    deps,
    userId,
    meals,
    operation,
    resolvedItem,
    explicitQuantity,
    timeZone,
  });
}
