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
  return /\d+(?:[,.]\d+)?\s*(?:g|gramas?|kg|ml|m\s*l|l|litros?|unidades?|fatias?|porcoes?|porções?)\b/i.test(
    item.portionText ?? ""
  );
}

export type WhatsappImageMealPersistenceInspection =
  | { status: "persistable" }
  | { status: "missing_identity" }
  | { status: "missing_portion"; item: MealDraftItem };

export function inspectWhatsappImageMealItemsPersistence(
  items: MealDraftItem[]
): WhatsappImageMealPersistenceInspection {
  if (!items.length || items.some(item => !hasFoodIdentity(item))) {
    return { status: "missing_identity" };
  }
  const item = items.find(candidate => !hasSafePortion(candidate));
  return item ? { status: "missing_portion", item } : { status: "persistable" };
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
      inspection.item.foodName?.trim() ||
      inspection.item.canonicalName?.trim() ||
      "esse alimento";
    throw new MealInferenceError(
      `Identifiquei ${foodName}, mas preciso da quantidade para registrar com segurança. Informe o peso, volume ou porção consumida.`
    );
  }
}
