import { processMealInput, type MealDraftItem } from "../../nutritionEngine";
import { createManualMeal, listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { parseMealCommandFromWhatsApp } from "./mealCommandParser";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";

type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string;
  items?: MealDraftItem[];
};

type DatedFoodAdditionResult = {
  handled: true;
  action: "meal_item_added";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
};

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatReplyDate(date: Date, timeZone: string) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
}

function formatItemsForProcessing(items: NonNullable<ReturnType<typeof parseMealCommandFromWhatsApp>["items"]>) {
  return items
    .map(item => [
      item.quantity ? String(item.quantity).replace(".", ",") : "1",
      item.unit ?? "unidade",
      item.foodName,
      item.brand,
    ].filter(Boolean).join(" "))
    .join(", ");
}

function findMealByLabel(meals: ExistingMeal[], mealLabel: string, referenceDate: Date, timeZone: string) {
  const normalizedLabel = normalizeIntentText(mealLabel);
  const targetDateKey = getDateKeyInTimeZone(referenceDate, timeZone);
  const matches = meals.filter(meal => {
    const candidate = normalizeIntentText(meal.mealLabel);
    return candidate === normalizedLabel || candidate.includes(normalizedLabel) || normalizedLabel.includes(candidate);
  });

  return matches.find(meal => {
    return getDateKeyInTimeZone(meal.occurredAt, timeZone) === targetDateKey;
  }) ?? null;
}

export async function executeWhatsappDatedFoodAdditionIntent(
  userId: number,
  input: { text?: string | null; receivedAt?: Date; userTimezone?: string | null },
): Promise<DatedFoodAdditionResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const timeZone = input.userTimezone ?? DEFAULT_APP_TIME_ZONE;
  const parsed = parseMealCommandFromWhatsApp(text, { referenceDate: input.receivedAt ?? new Date(), timeZone });
  if (parsed.intent !== "add_items_to_meal" || !parsed.mealType || !parsed.date || !parsed.items.length) {
    return null;
  }

  const foodText = formatItemsForProcessing(parsed.items);
  if (!foodText) return null;

  const processed = await processMealInput({ text: foodText, occurredAt: parsed.date, timeZone });
  const items = processed.items as MealItemInput[];
  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(meals, parsed.mealType, parsed.date, timeZone);

  if (targetMeal) {
    const updatedMeal = await updateMeal(userId, {
      mealId: targetMeal.id,
      mealLabel: targetMeal.mealLabel,
      occurredAt: new Date(targetMeal.occurredAt).toISOString(),
      notes: targetMeal.notes,
      items: [...(targetMeal.items ?? []), ...items] as MealItemInput[],
    });

    return {
      handled: true,
      action: "meal_item_added",
      reply: await composeWhatsAppMealActionReply({
        userId,
        meal: updatedMeal,
        timeZone,
        options: {
          title: items.length === 1 ? "Alimento adicionado" : "Alimentos adicionados",
          actionLines: [`Adicionei ${items.length} item(ns) à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt), timeZone)}.`],
        },
      }),
      eventType: "whatsapp.intent.meal_item_added",
      detail: `${items.length} alimento(s) adicionados à refeição existente ${targetMeal.mealLabel} com data explícita pelo WhatsApp.`,
      data: {
        mealId: updatedMeal.id,
        mealLabel: targetMeal.mealLabel,
        occurredAt: new Date(targetMeal.occurredAt).toISOString(),
        itemCount: items.length,
      },
    };
  }

  const createdMeal = await createManualMeal(userId, {
    mealLabel: parsed.mealType,
    occurredAt: parsed.date.toISOString(),
    items,
  });

  return {
    handled: true,
    action: "meal_item_added",
    reply: await composeWhatsAppMealActionReply({
      userId,
      meal: createdMeal,
      timeZone,
      options: {
        title: "Refeição registrada",
        actionLines: [`Registrei ${items.length} item(ns) no ${parsed.mealType} de ${formatReplyDate(parsed.date, timeZone)}.`],
        mealResultState: "registered",
      },
    }),
    eventType: "whatsapp.intent.meal_item_added",
    detail: `${items.length} alimento(s) registrados em nova refeição ${parsed.mealType} com data explícita pelo WhatsApp.`,
    data: {
      mealId: createdMeal.id,
      mealLabel: parsed.mealType,
      occurredAt: parsed.date.toISOString(),
      itemCount: items.length,
    },
  };
}
