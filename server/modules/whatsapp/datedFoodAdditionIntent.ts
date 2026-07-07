import { processMealInput, type MealDraftItem } from "../../nutritionEngine";
import { createManualMeal, listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { parseMealCommandFromWhatsApp } from "./mealCommandParser";
import { buildWhatsAppMealActionReplyMessage } from "./replyMessages";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

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

function startOfDay(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
}

function endOfDay(date: Date) {
  return new Date(startOfDay(date).getTime() + 24 * 60 * 60 * 1000 - 1);
}

function formatReplyDate(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: SAO_PAULO_TIME_ZONE,
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

function findMealByLabel(meals: ExistingMeal[], mealLabel: string, referenceDate: Date) {
  const normalizedLabel = normalizeIntentText(mealLabel);
  const dayStart = startOfDay(referenceDate).getTime();
  const dayEnd = endOfDay(referenceDate).getTime();
  const matches = meals.filter(meal => {
    const candidate = normalizeIntentText(meal.mealLabel);
    return candidate === normalizedLabel || candidate.includes(normalizedLabel) || normalizedLabel.includes(candidate);
  });

  return matches.find(meal => {
    const occurredAt = new Date(meal.occurredAt).getTime();
    return occurredAt >= dayStart && occurredAt <= dayEnd;
  }) ?? null;
}

export async function executeWhatsappDatedFoodAdditionIntent(
  userId: number,
  input: { text?: string | null; receivedAt?: Date },
): Promise<DatedFoodAdditionResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const parsed = parseMealCommandFromWhatsApp(text, { referenceDate: input.receivedAt ?? new Date() });
  if (parsed.intent !== "add_items_to_meal" || !parsed.mealType || !parsed.date || !parsed.items.length) {
    return null;
  }

  const foodText = formatItemsForProcessing(parsed.items);
  if (!foodText) return null;

  const processed = await processMealInput({ text: foodText });
  const items = processed.items as MealItemInput[];
  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(meals, parsed.mealType, parsed.date);

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
      reply: buildWhatsAppMealActionReplyMessage(updatedMeal, {
        title: items.length === 1 ? "Alimento adicionado" : "Alimentos adicionados",
        actionLines: [`Adicionei ${items.length} item(ns) à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt))}.`],
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
    reply: buildWhatsAppMealActionReplyMessage(createdMeal, {
      title: "Refeição registrada",
      actionLines: [`Registrei ${items.length} item(ns) no ${parsed.mealType} de ${formatReplyDate(parsed.date)}.`],
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
