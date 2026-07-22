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
  return /^\d+(?:[,.]\d+)?\s*(?:g|gramas?|kg|ml|m\s*l|l|litros?|porcao|porcoes?|porção|porções?|unidades?)?$/i.test(
    value
  );
}

function isReliableFoodIdentity(value?: string | null) {
  const normalized = normalizeIdentity(value);
  if (!normalized || GENERIC_IMAGE_FOOD_NAMES.has(normalized)) return false;
  if (isOnlyQuantityOrUnit(normalized)) return false;
  return /\p{L}/u.test(normalized);
}

export function resolveWhatsappImageVisibleFoodName(item: MealDraftItem) {
  if (isReliableFoodIdentity(item.foodName)) return item.foodName.trim();
  if (isReliableFoodIdentity(item.canonicalName))
    return item.canonicalName.trim();
  return null;
}

export function normalizeWhatsappImageMealItemsForPersistence(
  items: MealDraftItem[]
) {
  return items.map(item => {
    const visibleFoodName = resolveWhatsappImageVisibleFoodName(item);
    return visibleFoodName && visibleFoodName !== item.foodName?.trim()
      ? { ...item, foodName: visibleFoodName }
      : item;
  });
}

function hasSafePortion(item: MealDraftItem) {
  if (Number(item.quantity) > 0 && item.unit?.trim()) return true;
  if (Number(item.estimatedGrams) > 0) return true;
  return /\d+(?:[,.]\d+)?\s*(?:g|gramas?|kg|ml|m\s*l|l|litros?|unidades?|fatias?|porcoes?|porções?)\b/i.test(
    item.portionText ?? ""
  );
}

export function getWhatsappImageMissingPortionIndexes(items: MealDraftItem[]) {
  return items.flatMap((item, index) => (hasSafePortion(item) ? [] : [index]));
}

export type WhatsappImageMealPersistenceInspection =
  | { status: "persistable" }
  | { status: "missing_identity" }
  | { status: "missing_portion"; item: MealDraftItem; itemIndex: number };

export function inspectWhatsappImageMealItemsPersistence(
  items: MealDraftItem[]
): WhatsappImageMealPersistenceInspection {
  if (
    !items.length ||
    items.some(item => !resolveWhatsappImageVisibleFoodName(item))
  ) {
    return { status: "missing_identity" };
  }
  const itemIndex = items.findIndex(candidate => !hasSafePortion(candidate));
  return itemIndex >= 0
    ? { status: "missing_portion", item: items[itemIndex], itemIndex }
    : { status: "persistable" };
}

export function assertWhatsappImageMealItemsArePersistable(
  items: MealDraftItem[]
) {
  const inspection = inspectWhatsappImageMealItemsPersistence(items);
  if (inspection.status === "missing_identity") {
    throw new MealInferenceError(
      "Não consegui identificar o alimento na imagem. Envie outra foto com o alimento mais visível ou descreva o que comeu e a quantidade."
    );
  }
  if (inspection.status === "missing_portion") {
    const foodName =
      resolveWhatsappImageVisibleFoodName(inspection.item) || "esse alimento";
    throw new MealInferenceError(
      `Identifiquei ${foodName}, mas preciso da quantidade para registrar com segurança. Informe o peso, volume ou porção consumida.`
    );
  }
}
