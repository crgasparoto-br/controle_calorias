import { processMealInput, type MealDraftItem } from "../../nutritionEngine";
import { listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { parseMealCommandFromWhatsApp } from "./mealCommandParser";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { resolveWhatsappRelativeMealDateSelection } from "./intent/explicitMealDate";
import { findMealByLabel } from "./intent/mealItemHelpers";
import { buildWhatsappExplicitMealTargetMissingClarification } from "./intent/explicitMealTargetGuard";

type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string;
  items?: MealDraftItem[];
};

type DatedFoodAdditionResult = {
  handled: true;
  action: "meal_item_added" | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
};

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

export async function executeWhatsappDatedFoodAdditionIntent(
  userId: number,
  input: { text?: string | null; receivedAt?: Date; userTimezone?: string | null },
): Promise<DatedFoodAdditionResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const timeZone = input.userTimezone ?? DEFAULT_APP_TIME_ZONE;
  const referenceDate = input.receivedAt ?? new Date();
  const dateSelection = resolveWhatsappRelativeMealDateSelection({
    text,
    receivedAt: referenceDate,
    timeZone,
    fallbackDate: referenceDate,
  });
  if (!dateSelection.explicit) return null;

  const parsed = parseMealCommandFromWhatsApp(text, { referenceDate, timeZone });
  if (parsed.intent !== "add_items_to_meal" || !parsed.mealType || !parsed.items.length) {
    return null;
  }

  const foodText = formatItemsForProcessing(parsed.items);
  if (!foodText) return null;

  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(
    meals as ExistingMeal[],
    parsed.mealType,
    dateSelection.date,
    timeZone,
    { allowCrossDayFallback: false },
  );

  if (!targetMeal) {
    return {
      handled: true,
      action: "clarification_needed",
      ...buildWhatsappExplicitMealTargetMissingClarification({
        mealLabel: parsed.mealType,
        targetDate: dateSelection.date,
        timeZone,
      }),
    };
  }

  const processed = await processMealInput({
    text: foodText,
    occurredAt: dateSelection.date,
    timeZone,
  });
  const items = processed.items as MealItemInput[];
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
      explicitDate: true,
    },
  };
}
