import { MealInferenceError, type MealDraftItem } from "../../nutritionEngine";

const GENERIC_IMAGE_FOOD_NAMES = new Set([
  "alimento",
  "comida",
  "refeicao",
  "item",
  "prato",
  "porcao",
  "ingrediente",
  "produto",
  "desconhecido",
  "desconhecida",
  "indefinido",
  "indefinida",
]);

const GENERIC_IMAGE_IDENTITY_PATTERNS = [
  /^(?:nao\s+)?identificad[oa]$/,
  /^(?:nao\s+)?reconhecid[oa]$/,
  /^desconhecid[oa]$/,
  /^indefinid[oa]$/,
  /^(?:alimento|comida|refeicao|item|prato|porcao|ingrediente|produto)\s+(?:nao\s+)?(?:identificad[oa]|reconhecid[oa]|desconhecid[oa]|indefinid[oa])$/,
  /^(?:nao\s+foi\s+possivel\s+)?identificar\s+(?:o\s+|a\s+)?(?:alimento|comida|refeicao|item|prato|ingrediente|produto)$/,
  /^sem\s+(?:alimento|comida|item|ingrediente|produto)\s+(?:identificad[oa]|reconhecid[oa])$/,
  /^item\s+\d+$/,
  /^(?:objeto|imagem|foto)(?:\s+\d+)?$/,
  /^sem\s+(?:identificacao|descricao|nome)$/,
];

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
  return /^\d+(?:[,.]\d+)?\s*(?:g|gramas?|kg|ml|m\s*l|l|litros?|porcao|porcoes?|unidades?)?$/i.test(
    value
  );
}

function isGenericImageIdentity(value: string) {
  return (
    GENERIC_IMAGE_FOOD_NAMES.has(value) ||
    GENERIC_IMAGE_IDENTITY_PATTERNS.some(pattern => pattern.test(value))
  );
}

function isReliableFoodIdentity(value?: string | null) {
  const normalized = normalizeIdentity(value);
  if (!normalized || isGenericImageIdentity(normalized)) return false;
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

function hasUnsafeEstimatedPortionMarker(item: MealDraftItem) {
  const portion = normalizeIdentity(item.portionText);
  return /\b(?:nao\s+informad[oa]|sem\s+quantidade|aprox|aproximad[oa]|estimad[oa]|padrao)\b/.test(
    portion
  );
}

function hasGenericHeuristicPortion(item: MealDraftItem) {
  const unit = normalizeIdentity(item.unit);
  return item.source === "heuristic" && /^(?:porcao|porcoes)$/.test(unit);
}

function hasSafePortion(item: MealDraftItem) {
  if (
    hasUnsafeEstimatedPortionMarker(item) ||
    hasGenericHeuristicPortion(item)
  ) {
    return false;
  }
  if (Number(item.quantity) > 0 && item.unit?.trim()) return true;
  return /\d+(?:[,.]\d+)?\s*(?:g|gramas?|kg|ml|m\s*l|l|litros?|unidades?|fatias?|porcoes?)\b/i.test(
    normalizeIdentity(item.portionText)
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
