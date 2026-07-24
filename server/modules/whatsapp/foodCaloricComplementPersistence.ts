import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { appendSugarQuantityToCoffeeText } from "../../coffeeSugarNutrition";
import { normalizeText } from "../../mealTextParsing";
import type { MealDraftItem } from "../../nutritionEngineTypes";
import type { MealItemInput } from "../meals/schemas";
import type { CaloricComplementQuantityContext } from "./foodQuantityClarification";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import { consolidateWhatsAppMealAfterSave } from "./mealConsolidationService";
import { toMealItemInputs } from "./intent/mealItemHelpers";
import type { WhatsappIntentResult } from "./intent/types";

export type CaloricComplementPersistenceDependencies = {
  processFood: (input: {
    text: string;
    habits: Awaited<ReturnType<CaloricComplementPersistenceDependencies["getHabits"]>>;
    occurredAt: Date;
    timeZone: string;
  }) => Promise<{
    detectedMealLabel: string;
    items: MealDraftItem[];
  }>;
  getHabits: (userId: number) => Promise<unknown[]>;
  createMeal: (userId: number, input: {
    mealLabel: string;
    occurredAt: string;
    notes?: string | null;
    items: MealDraftItem[];
  }) => Promise<ExistingMeal>;
  listMeals: (userId: number) => Promise<ExistingMeal[]>;
  updateMeal: (userId: number, input: {
    mealId: number;
    mealLabel: string;
    occurredAt: string;
    notes?: string | null;
    items: MealItemInput[];
  }) => Promise<ExistingMeal>;
  removeMeal: (userId: number, mealId: number) => Promise<unknown>;
};

type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: Date | string | number;
  notes?: string | null;
  items?: MealDraftItem[] | MealItemInput[] | null;
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

async function processResolvedFood(
  deps: CaloricComplementPersistenceDependencies,
  userId: number,
  context: CaloricComplementQuantityContext,
  explicitQuantity: { quantity: number; unit: string },
  occurredAt: Date,
  timeZone: string,
) {
  const registrationText = appendSugarQuantityToCoffeeText(
    context.originalFoodText,
    explicitQuantity.quantity,
    explicitQuantity.unit,
  );
  const processed = await deps.processFood({
    text: registrationText,
    habits: await deps.getHabits(userId),
    occurredAt,
    timeZone,
  });
  const resolvedItem = assertCoherentSweetenedCoffee(processed.items[0]);
  return { processed, resolvedItem };
}

async function buildReply(
  userId: number,
  meal: ExistingMeal,
  timeZone: string,
  title: string,
  actionLine: string,
  state: "registered" | "updated",
) {
  return composeWhatsAppMealActionReply({
    userId,
    meal,
    timeZone,
    options: {
      title,
      actionLines: [actionLine],
      mealResultState: state,
    },
  });
}

export async function persistResolvedCaloricComplement(
  deps: CaloricComplementPersistenceDependencies,
  userId: number,
  context: CaloricComplementQuantityContext,
  explicitQuantity: { quantity: number; unit: string } | undefined,
  receivedAt: Date,
  timeZone: string,
): Promise<WhatsappIntentResult> {
  if (!explicitQuantity) {
    throw new Error("A quantidade do complemento não foi informada.");
  }

  const operationOccurredAt = context.operation.kind === "register"
    ? new Date(context.operation.occurredAt)
    : receivedAt;
  const { processed, resolvedItem } = await processResolvedFood(
    deps,
    userId,
    context,
    explicitQuantity,
    operationOccurredAt,
    timeZone,
  );

  if (context.operation.kind === "register") {
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
            resolvedItem,
          ],
        })
      : await deps.createMeal(userId, {
          mealLabel: processed.detectedMealLabel || "Refeição",
          occurredAt: operationOccurredAt.toISOString(),
          notes: context.originalFoodText,
          items: [resolvedItem],
        });
    const consolidated = existing
      ? { action: "updated" as const, meal: saved }
      : await consolidateWhatsAppMealAfterSave(
          {
            listUserMeals: deps.listMeals,
            updateUserMeal: input => deps.updateMeal(input.userId, {
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
    const reloaded = (await deps.listMeals(userId)).find(meal => meal.id === consolidated.meal.id)
      ?? consolidated.meal;

    return {
      handled: true,
      action: "food_clarification_completed",
      reply: await buildReply(
        userId,
        reloaded,
        timeZone,
        consolidated.action === "updated" ? "Alimento adicionado" : "Refeição registrada",
        `Registrei ${resolvedItem.foodName} com ${explicitQuantity.quantity} ${explicitQuantity.unit} de açúcar.`,
        consolidated.action === "updated" ? "updated" : "registered",
      ),
      eventType: "whatsapp.food_clarification.completed",
      detail: "Registro de café com açúcar concluído após clarificação persistente e recarga do estado.",
      data: { mealId: reloaded.id, component: context.componentName },
    };
  }

  const meals = await deps.listMeals(userId);
  const currentMeal = meals.find(meal => meal.id === context.operation.mealId);
  if (!currentMeal) throw new Error("A refeição-alvo já não está disponível.");

  if (context.operation.kind === "add_to_meal") {
    if (
      normalizeText(currentMeal.mealLabel) !== normalizeText(context.operation.expectedMealLabel)
      || new Date(currentMeal.occurredAt).toISOString() !== context.operation.expectedOccurredAt
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
        resolvedItem,
      ],
    });
    const reloaded = (await deps.listMeals(userId)).find(meal => meal.id === currentMeal.id);
    if (!reloaded) throw new Error("A refeição atualizada não pôde ser recarregada.");

    return {
      handled: true,
      action: "food_clarification_completed",
      reply: await buildReply(
        userId,
        reloaded,
        timeZone,
        "Alimento adicionado",
        `Adicionei ${resolvedItem.foodName} com ${explicitQuantity.quantity} ${explicitQuantity.unit} de açúcar.`,
        "updated",
      ),
      eventType: "whatsapp.food_clarification.completed",
      detail: "Adição de café com açúcar concluída após revalidação da refeição-alvo.",
      data: { mealId: reloaded.id, component: context.componentName },
    };
  }

  const items = toMealItemInputs(currentMeal.items as MealDraftItem[] | undefined);
  const currentItem = items[context.operation.itemIndex];
  if (!currentItem) throw new Error("O item-alvo já não está disponível.");
  const expectedName = normalizeText(context.operation.originalFoodName);
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
      index === context.operation.itemIndex ? resolvedItem : item,
    ),
  });
  const reloaded = (await deps.listMeals(userId)).find(meal => meal.id === currentMeal.id);
  if (!reloaded) throw new Error("A refeição corrigida não pôde ser recarregada.");

  return {
    handled: true,
    action: "food_clarification_completed",
    reply: await buildReply(
      userId,
      reloaded,
      timeZone,
      "Alimento substituído",
      `${context.operation.originalFoodName} → ${resolvedItem.foodName} com ${explicitQuantity.quantity} ${explicitQuantity.unit} de açúcar.`,
      "updated",
    ),
    eventType: "whatsapp.food_clarification.completed",
    detail: "Substituição por café com açúcar concluída após revalidação do item-alvo.",
    data: {
      mealId: reloaded.id,
      correctedItemIndex: context.operation.itemIndex,
      component: context.componentName,
    },
  };
}
