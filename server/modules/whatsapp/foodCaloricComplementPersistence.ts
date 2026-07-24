import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { appendSugarQuantityToCoffeeText } from "../../coffeeSugarNutrition";
import { isCoffeeWithAddedSugar } from "../../foodSemanticCompatibility";
import { normalizeText } from "../../mealTextParsing";
import type { MealDraftItem } from "../../nutritionEngineTypes";
import type { CaloricComplementQuantityContext } from "./foodQuantityClarification";
import type { FoodClarificationDependencies } from "./foodClarificationPersistence";
import type { WhatsappIntentResult } from "./intent/types";
import { toMealItemInputs } from "./intent/mealItemHelpers";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import { consolidateWhatsAppMealAfterSave } from "./mealConsolidationService";

type ExistingMeal = Awaited<
  ReturnType<FoodClarificationDependencies["listMeals"]>
>[number];

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
  if (matches.length !== 1) {
    throw new Error("A clarificação de açúcar não identificou um único café adoçado.");
  }
  return assertCoherentSweetenedCoffee(matches[0]);
}

async function processResolvedFood(
  deps: FoodClarificationDependencies,
  userId: number,
  context: CaloricComplementQuantityContext,
  explicitQuantity: { quantity: number; unit: string },
  occurredAt: Date,
  timeZone: string,
) {
  const processed = await deps.processFood({
    text: appendSugarQuantityToCoffeeText(
      context.originalFoodText,
      explicitQuantity.quantity,
      explicitQuantity.unit,
    ),
    habits: await deps.getHabits(userId),
    occurredAt,
    timeZone,
  });
  const resolvedItems = toMealItemInputs(processed.items);
  return {
    processed,
    resolvedItems,
    resolvedItem: findResolvedSweetenedCoffee(processed.items),
  };
}

function buildCompletedActionLine(input: {
  action: "register" | "add";
  itemCount: number;
  resolvedItem: MealDraftItem;
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
  const { processed, resolvedItems, resolvedItem } = await processResolvedFood(
    deps,
    userId,
    context,
    explicitQuantity,
    operationOccurredAt,
    timeZone,
  );

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
          notes: existing.notes || context.originalFoodText,
          items: [
            ...toMealItemInputs(existing.items as MealDraftItem[] | undefined),
            ...resolvedItems,
          ],
        })
      : await deps.createMeal(userId, {
          mealLabel: processed.detectedMealLabel || "Refeição",
          occurredAt: operationOccurredAt.toISOString(),
          notes: context.originalFoodText,
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
      },
    };
  }

  if (operation.kind !== "replace_item") {
    throw new Error("Operação de complemento calórico não suportada.");
  }
  const items = toMealItemInputs(
    currentMeal.items as MealDraftItem[] | undefined,
  );
  const currentItem = items[operation.itemIndex];
  if (!currentItem) throw new Error("O item-alvo já não está disponível.");
  const expectedName = normalizeText(operation.originalFoodName);
  if (![currentItem.foodName, currentItem.canonicalName]
    .map(value => normalizeText(value ?? ""))
    .includes(expectedName)) {
    throw new Error("O item-alvo mudou antes da conclusão da substituição.");
  }

  await deps.updateMeal(userId, {
    mealId: currentMeal.id,
    mealLabel: currentMeal.mealLabel,
    occurredAt: new Date(currentMeal.occurredAt).toISOString(),
    notes: currentMeal.notes,
    items: items.map((item, index) =>
      index === operation.itemIndex ? resolvedItem : item,
    ),
  });
  const reloaded = (await deps.listMeals(userId)).find(
    meal => meal.id === currentMeal.id,
  );
  if (!reloaded) throw new Error("A refeição corrigida não pôde ser recarregada.");

  return {
    handled: true,
    action: "food_clarification_completed",
    reply: await buildReply({
      userId,
      meal: reloaded,
      timeZone,
      title: "Alimento substituído",
      actionLine: `${operation.originalFoodName} → ${resolvedItem.foodName} com ${explicitQuantity.quantity} ${explicitQuantity.unit} de açúcar.`,
      state: "updated",
    }),
    eventType: "whatsapp.food_clarification.completed",
    detail: "Substituição por café com açúcar concluída após revalidação do item-alvo.",
    data: {
      mealId: reloaded.id,
      correctedItemIndex: operation.itemIndex,
      component: context.componentName,
    },
  };
}
