import { handleFoodAdditionIntent } from "./intent/foodAdditionHandlers";
import { parseMealCommandFromWhatsApp } from "./mealCommandParser";
import { resolveWhatsappRelativeMealDateSelection } from "./intent/explicitMealDate";
import { listMealSchedules } from "../mealSchedules/service";
import type { FoodAdditionIntent, WhatsappIntentInput, WhatsappIntentResult } from "./intent/types";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";

/**
 * Roteia somente comandos completos com data explícita para o handler canônico
 * de adição. Comandos incompletos (por exemplo, "Adicionar água ontem") ficam
 * disponíveis para os intents especializados de água e clarificação.
 */
export async function executeWhatsappDatedFoodAdditionIntent(
  userId: number,
  input: WhatsappIntentInput,
): Promise<WhatsappIntentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const timeZone = input.userTimezone ?? DEFAULT_APP_TIME_ZONE;
  const receivedAt = input.receivedAt ?? new Date();
  const dateSelection = resolveWhatsappRelativeMealDateSelection({
    text,
    receivedAt,
    timeZone,
    fallbackDate: receivedAt,
  });
  if (!dateSelection.explicit) return null;

  const configuredSchedules = await listMealSchedules(userId);
  const parsed = parseMealCommandFromWhatsApp(text, {
    referenceDate: receivedAt,
    timeZone,
    mealLabels: configuredSchedules.map(schedule => schedule.mealLabel),
  });

  const completeItems = parsed.items.length > 0
    && parsed.items.every(item => (
      Boolean(item.foodName?.trim())
      && item.quantity !== null
      && item.quantity !== undefined
      && Number.isFinite(item.quantity)
      && Boolean(item.unit?.trim())
    ));

  if (
    parsed.intent !== "add_items_to_meal"
    || !parsed.mealType
    || !completeItems
  ) {
    return null;
  }

  const addition: FoodAdditionIntent = {
    mealLabel: parsed.mealType,
    date: dateSelection.date,
    items: parsed.items.map(item => ({
      foodName: item.foodName ?? "",
      quantity: item.quantity ?? 1,
      unit: item.unit ?? "unidade",
      brand: item.brand ?? null,
    })),
  };

  return handleFoodAdditionIntent(userId, addition, timeZone, {
    originalText: text,
    receivedAt,
  });
}
