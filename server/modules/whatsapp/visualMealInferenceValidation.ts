import { MealInferenceError, type MealDraftItem } from "../../nutritionEngine";

const GENERIC_IMAGE_FOOD_NAMES = new Set([
  "alimento",
  "comida",
  "refeicao",
  "refeição",
  "item",
  "prato",
  "porcao",
  "porção",
]);

function normalizeIdentity(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOnlyQuantityOrUnit(value: string) {
  return /^\d+(?:[,.]\d+)?\s*(?:g|gramas?|kg|ml|m\s*l|l|litros?|porcao|porcoes?|porção|porções?|unidades?)?$/i.test(value);
}

function hasFoodIdentity(item: MealDraftItem) {
  const names = [item.foodName, item.canonicalName]
    .map(normalizeIdentity)
    .filter(Boolean);

  return names.some(name => {
    if (GENERIC_IMAGE_FOOD_NAMES.has(name)) return false;
    if (isOnlyQuantityOrUnit(name)) return false;
    return /\p{L}/u.test(name);
  });
}

function hasSafePortion(item: MealDraftItem) {
  if (Number(item.quantity) > 0 && item.unit?.trim()) return true;
  if (Number(item.estimatedGrams) > 0) return true;
  return /\d+(?:[,.]\d+)?\s*(?:g|gramas?|kg|ml|m\s*l|l|litros?|unidades?|fatias?|porcoes?|porções?)\b/i
    .test(item.portionText ?? "");
}

export function assertWhatsappImageMealItemsArePersistable(items: MealDraftItem[]) {
  if (!items.length) {
    throw new MealInferenceError(
      "Não consegui identificar o alimento na imagem. Envie outra foto com o alimento mais visível ou descreva o que comeu e a quantidade.",
    );
  }

  const itemWithoutIdentity = items.find(item => !hasFoodIdentity(item));
  if (itemWithoutIdentity) {
    throw new MealInferenceError(
      "Não consegui identificar o alimento na imagem. Envie outra foto com o alimento mais visível ou descreva o que comeu e a quantidade.",
    );
  }

  const itemWithoutPortion = items.find(item => !hasSafePortion(item));
  if (itemWithoutPortion) {
    const foodName = itemWithoutPortion.foodName?.trim() || itemWithoutPortion.canonicalName?.trim() || "esse alimento";
    throw new MealInferenceError(
      `Identifiquei ${foodName}, mas preciso da quantidade para registrar com segurança. Informe o peso, volume ou porção consumida.`,
    );
  }
}
