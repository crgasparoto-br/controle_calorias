import { DEFAULT_APP_TIME_ZONE } from "../../../../shared/timeZone";
import { getHabitSnapshots } from "../../../db";
import { isCoffeeWithAddedSugar } from "../../../foodSemanticCompatibility";
import { MealInferenceError, processMealInput } from "../../../nutritionEngine";
import { requestWhatsappCaloricComplementQuantityClarification } from "../foodQuantityClarification";
import { buildWhatsAppClarificationReplyMessage } from "../replyMessages";
import { composeWhatsAppMealActionReply } from "../mealActionReplyComposer";
import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import { formatReplyDate, resolveRelativeOccurredAt } from "./dateTime";
import {
  buildCoffeeLorCapsuleItem,
  buildFoodAdditionItem,
  buildUnsweetenedCoffeeItem,
  findMealByLabel,
  formatAddedItemsList,
  formatTotalsLine,
  toMealItemInputs,
} from "./mealItemHelpers";
import type { CoffeeAdditionIntent, CoffeeLorCapsuleIntent, ExistingMeal, FoodAdditionIntent, WhatsappIntentResult } from "./types";

type AdditionExecutionContext = {
  originalText?: string;
  receivedAt?: Date;
  messageId?: string | null;
};

type FoodAdditionItem = FoodAdditionIntent["items"][number];

function buildAdditionFoodText(item: FoodAdditionItem) {
  return item.quantity
    ? `${item.quantity} ${item.unit} de ${item.foodName}`
    : item.foodName;
}

function findResolvedSweetenedCoffee(items: MealItemInput[]) {
  const matches = items.filter(item =>
    isCoffeeWithAddedSugar(`${item.foodName} ${item.canonicalName ?? ""}`)
  );
  return matches.length === 1 ? matches[0] : null;
}

async function resolveAdditionItems(input: {
  userId: number;
  addition: FoodAdditionIntent;
  targetMeal: ExistingMeal;
  timeZone: string;
  context?: AdditionExecutionContext;
}): Promise<
  | { kind: "items"; items: MealItemInput[] }
  | { kind: "clarification"; result: WhatsappIntentResult }
> {
  const resolvedItems = input.addition.items.map(item =>
    buildFoodAdditionItem(item.foodName, item.quantity, item.unit)
  );
  const coffeeIndexes = input.addition.items
    .map((item, index) => isCoffeeWithAddedSugar(item.foodName) ? index : -1)
    .filter(index => index >= 0);
  if (!coffeeIndexes.length) return { kind: "items", items: resolvedItems };

  const receivedAt = input.context?.receivedAt ?? input.addition.date;
  const habits = await getHabitSnapshots(input.userId);

  for (const coffeeIndex of coffeeIndexes) {
    const originalFoodText = buildAdditionFoodText(input.addition.items[coffeeIndex]);
    try {
      const processed = await processMealInput({
        text: originalFoodText,
        habits,
        occurredAt: receivedAt,
        timeZone: input.timeZone,
      });
      const resolvedCoffee = findResolvedSweetenedCoffee(
        toMealItemInputs(processed.items),
      );
      if (!resolvedCoffee) throw new MealInferenceError();
      resolvedItems[coffeeIndex] = resolvedCoffee;
    } catch (error) {
      if (
        error instanceof MealInferenceError
        && error.code === "food_component_quantity_required"
      ) {
        return {
          kind: "clarification",
          result: await requestWhatsappCaloricComplementQuantityClarification({
            userId: input.userId,
            originalFoodText,
            operation: {
              kind: "add_to_meal",
              mealId: input.targetMeal.id,
              expectedMealLabel: input.targetMeal.mealLabel,
              expectedOccurredAt: new Date(input.targetMeal.occurredAt).toISOString(),
            },
            receivedAt,
            messageId: input.context?.messageId,
          }),
        };
      }
      throw error;
    }
  }

  return { kind: "items", items: resolvedItems };
}

export async function handleFoodAdditionIntent(
  userId: number,
  addition: FoodAdditionIntent,
  timeZone = DEFAULT_APP_TIME_ZONE,
  context?: AdditionExecutionContext,
): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(meals, addition.mealLabel, addition.date, timeZone);
  if (!targetMeal) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(`Não encontrei a refeição ${addition.mealLabel} em ${formatReplyDate(addition.date, timeZone)}. Me diga em qual refeição devo adicionar ${addition.items[0]?.foodName ?? "o alimento"}.`),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido para adicionar alimento sem refeição compatível no dia indicado.",
    };
  }

  const resolution = await resolveAdditionItems({
    userId,
    addition,
    targetMeal,
    timeZone,
    context,
  });
  if (resolution.kind === "clarification") return resolution.result;
  const addedItems = resolution.items;

  const updatedMeal = await updateMeal(userId, {
    mealId: targetMeal.id,
    mealLabel: targetMeal.mealLabel,
    occurredAt: new Date(targetMeal.occurredAt).toISOString(),
    notes: targetMeal.notes,
    items: [...(targetMeal.items ?? []), ...addedItems] as MealItemInput[],
  });

  if (addedItems.length === 1) {
    const addedItem = addedItems[0];
    const recalculationSource = addedItem.source === "catalog" ? "com base no catálogo" : "por estimativa";
    return {
      handled: true,
      action: "meal_item_added",
      reply: await composeWhatsAppMealActionReply({
        userId,
        meal: updatedMeal,
        timeZone,
        options: {
          title: "Alimento adicionado",
          actionLines: [
            `Adicionei ${addedItem.portionText} de ${addedItem.foodName} à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt), timeZone)}. Estimativa ${recalculationSource}: ${formatTotalsLine(addedItem)}.`,
          ],
        },
      }),
      eventType: "whatsapp.intent.meal_item_added",
      detail: `Alimento ${addedItem.foodName} adicionado à refeição ${targetMeal.mealLabel} via WhatsApp com data relativa interpretada.`,
      data: {
        mealId: updatedMeal.id,
        mealLabel: targetMeal.mealLabel,
        foodName: addedItem.foodName,
        quantity: addedItem.quantity,
        unit: addedItem.unit,
        estimatedGrams: addedItem.estimatedGrams,
        calories: addedItem.calories,
        protein: addedItem.protein,
        carbs: addedItem.carbs,
        fat: addedItem.fat,
        nutritionSource: addedItem.source,
      },
    };
  }

  return {
    handled: true,
    action: "meal_item_added",
    reply: await composeWhatsAppMealActionReply({
      userId,
      meal: updatedMeal,
      timeZone,
      options: {
        title: "Alimentos adicionados",
        actionLines: [
          `Adicionado à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt), timeZone)}: ${formatAddedItemsList(addedItems)}.`,
        ],
      },
    }),
    eventType: "whatsapp.intent.meal_item_added",
    detail: `${addedItems.length} alimentos adicionados à refeição ${targetMeal.mealLabel} via WhatsApp com data relativa interpretada.`,
    data: {
      mealId: updatedMeal.id,
      mealLabel: targetMeal.mealLabel,
      itemCount: addedItems.length,
      items: addedItems.map(item => ({
        foodName: item.foodName,
        quantity: item.quantity,
        unit: item.unit,
        estimatedGrams: item.estimatedGrams,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        nutritionSource: item.source,
      })),
    },
  };
}

export async function handleCoffeeAdditionIntent(userId: number, text: string, addition: CoffeeAdditionIntent, receivedAt: Date, timeZone = DEFAULT_APP_TIME_ZONE): Promise<WhatsappIntentResult> {
  if (!addition.cups || !addition.mealLabel) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage("Entendi que você quer adicionar café sem açúcar. Me diga a quantidade e a refeição. Exemplo: adicionar 3 xícaras de café sem açúcar à refeição café da manhã."),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido para adicionar café sem açúcar sem quantidade ou refeição explícita.",
    };
  }

  const targetDate = resolveRelativeOccurredAt(text, receivedAt, timeZone);
  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(meals, addition.mealLabel, targetDate, timeZone);
  if (!targetMeal) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(`Não encontrei a refeição ${addition.mealLabel}. Me diga em qual refeição devo adicionar o café.`),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido para adicionar café sem açúcar sem refeição compatível.",
    };
  }

  const coffeeItem = buildUnsweetenedCoffeeItem(addition.cups);
  const updatedMeal = await updateMeal(userId, {
    mealId: targetMeal.id,
    mealLabel: targetMeal.mealLabel,
    occurredAt: new Date(targetMeal.occurredAt).toISOString(),
    notes: targetMeal.notes,
    items: [...(targetMeal.items ?? []), coffeeItem] as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_added",
    reply: await composeWhatsAppMealActionReply({
      userId,
      meal: updatedMeal,
      timeZone,
      options: {
        title: "Alimento adicionado",
        actionLines: [
          `Adicionei ${coffeeItem.portionText} de café sem açúcar à refeição ${targetMeal.mealLabel}. Estimativa: ${formatTotalsLine(coffeeItem)}.`,
        ],
      },
    }),
    eventType: "whatsapp.intent.meal_item_added",
    detail: `Café sem açúcar adicionado à refeição ${targetMeal.mealLabel} via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      mealLabel: targetMeal.mealLabel,
      foodName: coffeeItem.foodName,
      cups: addition.cups,
      quantity: coffeeItem.quantity,
      unit: coffeeItem.unit,
      calories: coffeeItem.calories,
    },
  };
}

export async function handleCoffeeLorCapsuleIntent(userId: number, text: string, intent: CoffeeLorCapsuleIntent, receivedAt: Date, timeZone = DEFAULT_APP_TIME_ZONE): Promise<WhatsappIntentResult> {
  let targetMeal: ExistingMeal | undefined;

  if (intent.mealLabel) {
    const targetDate = resolveRelativeOccurredAt(text, receivedAt, timeZone);
    const meals = await listMeals(userId);
    targetMeal = findMealByLabel(meals, intent.mealLabel, targetDate, timeZone);
    if (!targetMeal) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: buildWhatsAppClarificationReplyMessage(`Não encontrei a refeição ${intent.mealLabel}. Me diga em qual refeição devo adicionar o café.`),
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido para adicionar café em cápsula L'Or sem refeição compatível.",
      };
    }
  } else {
    targetMeal = (await listMeals(userId))[0];
    if (!targetMeal) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma refeição recente. Me diga em qual refeição devo adicionar o café."),
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido para adicionar café em cápsula L'Or sem refeição recente.",
      };
    }
  }

  const capsuleItem = buildCoffeeLorCapsuleItem(intent.quantity);
  const updatedMeal = await updateMeal(userId, {
    mealId: targetMeal.id,
    mealLabel: targetMeal.mealLabel,
    occurredAt: new Date(targetMeal.occurredAt).toISOString(),
    notes: targetMeal.notes,
    items: [...(targetMeal.items ?? []), capsuleItem] as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_added",
    reply: await composeWhatsAppMealActionReply({
      userId,
      meal: updatedMeal,
      timeZone,
      options: {
        title: "Alimento adicionado",
        actionLines: [
          `Adicionei ${capsuleItem.portionText} de ${capsuleItem.foodName} à refeição ${targetMeal.mealLabel}. Estimativa: ${formatTotalsLine(capsuleItem)}.`,
        ],
      },
    }),
    eventType: "whatsapp.intent.meal_item_added",
    detail: `Café em cápsula L'Or adicionado à refeição ${targetMeal.mealLabel} via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      mealLabel: targetMeal.mealLabel,
      foodName: capsuleItem.foodName,
      quantity: intent.quantity,
      unit: capsuleItem.unit,
      calories: capsuleItem.calories,
    },
  };
}
