import { DEFAULT_APP_TIME_ZONE } from "../../../../shared/timeZone";
import { buildWhatsAppClarificationReplyMessage, buildWhatsAppMealActionReplyMessage } from "../replyMessages";
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
} from "./mealItemHelpers";
import type { CoffeeAdditionIntent, CoffeeLorCapsuleIntent, ExistingMeal, FoodAdditionIntent, WhatsappIntentResult } from "./types";

export async function handleFoodAdditionIntent(userId: number, addition: FoodAdditionIntent, timeZone = DEFAULT_APP_TIME_ZONE): Promise<WhatsappIntentResult> {
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

  const addedItems = addition.items.map(item => buildFoodAdditionItem(item.foodName, item.quantity, item.unit));
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
      reply: buildWhatsAppMealActionReplyMessage(updatedMeal, {
        title: "Alimento adicionado",
        actionLines: [
          `Adicionei ${addedItem.portionText} de ${addedItem.foodName} à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt), timeZone)}. Estimativa ${recalculationSource}: ${formatTotalsLine(addedItem)}.`,
        ],
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
    reply: buildWhatsAppMealActionReplyMessage(updatedMeal, {
      title: "Alimentos adicionados",
      actionLines: [
        `Adicionado à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt), timeZone)}: ${formatAddedItemsList(addedItems)}.`,
      ],
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
    reply: buildWhatsAppMealActionReplyMessage(updatedMeal, {
      title: "Alimento adicionado",
      actionLines: [
        `Adicionei ${coffeeItem.portionText} de café sem açúcar à refeição ${targetMeal.mealLabel}. Estimativa: ${formatTotalsLine(coffeeItem)}.`,
      ],
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
    reply: buildWhatsAppMealActionReplyMessage(updatedMeal, {
      title: "Alimento adicionado",
      actionLines: [
        `Adicionei ${capsuleItem.portionText} de ${capsuleItem.foodName} à refeição ${targetMeal.mealLabel}. Estimativa: ${formatTotalsLine(capsuleItem)}.`,
      ],
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
