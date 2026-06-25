import { normalizeMeasurementUnit } from "../../../shared/measurementUnits";

export type MealCommandIntent =
  | "add_items_to_meal"
  | "replace_quantity"
  | "correct_quantity"
  | "remove_item"
  | "replace_item"
  | "update_brand"
  | "unknown";

export type ParsedMealCommandItem = {
  foodName: string | null;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  missingFields: string[];
  quantityExpression?: {
    leftQuantity: number;
    rightQuantity: number;
    operator: "-" | "+";
    unit: string;
    result: number;
    raw: string;
  };
};

export type ParsedMealCommand = {
  intent: MealCommandIntent;
  mealType: string | null;
  date: Date | null;
  items: ParsedMealCommandItem[];
  previousQuantity?: number | null;
  previousUnit?: string | null;
  nextQuantity?: number | null;
  nextUnit?: string | null;
  confidence: number;
  missingFields: string[];
};

export type MealCommandContext = {
  referenceDate?: Date;
  recentMealType?: string | null;
  recentDate?: Date | null;
};

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const QUANTITY_UNIT_PATTERN = "g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|un|unidades?|fatias?|colheres? de sopa|colheres? de ch[aá]|x[ií]caras?|copos?|doses?|scoops?|long\\s*neck|longneck|latas?|garrafas?|por[cç][oõ]es?|por[cç][aã]o";
const DECIMAL_NUMBER_PATTERN = "\\d+(?:[,.]\\d+)?";

const MEAL_TYPES = [
  "cafe da manha",
  "café da manhã",
  "almoco",
  "almoço",
  "jantar",
  "lanche da tarde",
  "lanche",
  "ceia",
];

const KNOWN_BRANDS = [
  "Elma Chips",
  "Budweiser",
];

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type ParsedQuantity = {
  quantity: number;
  unit: string;
  index: number;
  raw: string;
};

type QuantityExpressionParseResult =
  | {
      kind: "valid";
      quantity: number;
      unit: string;
      index: number;
      raw: string;
      expression: NonNullable<ParsedMealCommandItem["quantityExpression"]>;
    }
  | {
      kind: "invalid";
      index: number;
      raw: string;
      reason: "incompatible_units" | "missing_unit" | "non_positive_result";
    };

function emptyCommand(intent: MealCommandIntent, missingFields: string[] = []): ParsedMealCommand {
  return {
    intent,
    mealType: null,
    date: null,
    items: [],
    confidence: intent === "unknown" ? 0 : 0.55,
    missingFields,
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingDate(value: string) {
  return value.replace(/\s+(?:de\s+)?(?:hoje|ontem|anteontem|amanh[aã])\s*$/i, "").trim();
}

function getZonedParts(date: Date, timeZone = SAO_PAULO_TIME_ZONE): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function makeDateInTimeZone(parts: ZonedParts, timeZone = SAO_PAULO_TIME_ZONE) {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const actualParts = getZonedParts(utcGuess, timeZone);
  const desiredUtcMinutes = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 60_000;
  const actualUtcMinutes = Date.UTC(
    actualParts.year,
    actualParts.month - 1,
    actualParts.day,
    actualParts.hour,
    actualParts.minute,
    actualParts.second,
  ) / 60_000;
  const offsetMinutes = actualUtcMinutes - desiredUtcMinutes;
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function addDaysToZonedDate(parts: ZonedParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function resolveCommandDate(input: string, context: MealCommandContext) {
  const referenceDate = context.referenceDate ?? new Date();
  const normalized = normalizeText(input);
  const referenceParts = getZonedParts(referenceDate);

  if (/\banteontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -2));
  }
  if (/\bontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -1));
  }
  if (/\bamanha\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, 1));
  }
  if (/\bhoje\b/.test(normalized)) {
    return referenceDate;
  }

  return context.recentDate ?? referenceDate;
}

function findMealType(input: string, context: MealCommandContext) {
  const normalized = normalizeText(input);
  const mealType = MEAL_TYPES.find(candidate => normalized.includes(normalizeText(candidate)));
  if (mealType) {
    return mealType
      .replace("almoco", "almoço")
      .replace("cafe da manha", "café da manhã");
  }
  return context.recentMealType ?? null;
}

function normalizeUnit(unit: string) {
  return normalizeMeasurementUnit(unit.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

function parseDecimalQuantity(value: string) {
  return Number(value.replace(",", "."));
}

function parseQuantity(value: string): ParsedQuantity | null {
  const match = value.match(new RegExp(`(${DECIMAL_NUMBER_PATTERN})\\s*(${QUANTITY_UNIT_PATTERN})\\b`, "i"));
  if (!match) {
    return null;
  }

  return {
    quantity: parseDecimalQuantity(match[1]),
    unit: normalizeUnit(match[2]),
    index: match.index ?? 0,
    raw: match[0],
  };
}

function unitsAreCompatible(firstUnit: string, secondUnit: string) {
  return normalizeUnit(firstUnit) === normalizeUnit(secondUnit);
}

function parseQuantityExpression(value: string): QuantityExpressionParseResult | null {
  const expressionPattern = new RegExp(
    `(${DECIMAL_NUMBER_PATTERN})\\s*(${QUANTITY_UNIT_PATTERN})?\\s*([-+])\\s*(${DECIMAL_NUMBER_PATTERN})\\s*(${QUANTITY_UNIT_PATTERN})?\\b`,
    "i",
  );
  const match = value.match(expressionPattern);
  if (!match) {
    return null;
  }

  const leftQuantity = parseDecimalQuantity(match[1]);
  const rightQuantity = parseDecimalQuantity(match[4]);
  const leftUnit = match[2] ? normalizeUnit(match[2]) : null;
  const rightUnit = match[5] ? normalizeUnit(match[5]) : null;
  const raw = match[0];
  const index = match.index ?? 0;
  const unit = leftUnit ?? rightUnit;

  if (!unit) {
    return { kind: "invalid", index, raw, reason: "missing_unit" };
  }
  if (leftUnit && rightUnit && !unitsAreCompatible(leftUnit, rightUnit)) {
    return { kind: "invalid", index, raw, reason: "incompatible_units" };
  }

  const result = match[3] === "-"
    ? leftQuantity - rightQuantity
    : leftQuantity + rightQuantity;
  if (!Number.isFinite(result) || result <= 0) {
    return { kind: "invalid", index, raw, reason: "non_positive_result" };
  }

  return {
    kind: "valid",
    quantity: Number(result.toFixed(3)),
    unit,
    index,
    raw,
    expression: {
      leftQuantity,
      rightQuantity,
      operator: match[3] as "-" | "+",
      unit,
      result: Number(result.toFixed(3)),
      raw,
    },
  };
}

function detectBrand(foodName: string) {
  return KNOWN_BRANDS.find(brand => normalizeText(foodName).includes(normalizeText(brand))) ?? null;
}

function removeBrand(foodName: string, brand: string | null) {
  if (!brand) {
    return foodName;
  }

  return normalizeSpaces(foodName.replace(new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), ""));
}

function cleanFoodName(value: string) {
  return normalizeSpaces(
    stripTrailingDate(value)
      .replace(/^(?:a|ao|à|no|na)\s+(?:refei[cç][aã]o\s+)?(?:caf[eé]\s+da\s+manh[aã]|almo[cç]o|jantar|lanche(?:\s+da\s+tarde)?|ceia)(?:\s+(?:de\s+)?(?:hoje|ontem|anteontem|amanh[aã]))?\s+/i, "")
      .replace(/^(?:de|do|da|dos|das)\s+/i, "")
      .replace(/[.,;:!?]+$/g, ""),
  );
}

function buildItem(
  foodNameInput: string,
  quantity: number | null,
  unit: string | null,
  quantityExpression?: ParsedMealCommandItem["quantityExpression"],
): ParsedMealCommandItem {
  const rawFoodName = cleanFoodName(foodNameInput);
  const brand = detectBrand(rawFoodName);
  const foodName = removeBrand(rawFoodName, brand) || rawFoodName || null;
  const missingFields = [
    ...(foodName ? [] : ["foodName"]),
    ...(quantity ? [] : ["quantity"]),
    ...(unit ? [] : ["unit"]),
  ];

  return {
    foodName,
    brand,
    quantity,
    unit,
    confidence: missingFields.length ? 0.55 : brand ? 0.88 : quantityExpression ? 0.9 : 0.82,
    missingFields,
    ...(quantityExpression ? { quantityExpression } : {}),
  };
}

function splitItemParts(value: string) {
  return value
    .split(/\s*[;]\s*|\s*(?<!\d),(?!\d)\s*|\s+\be\s+(?=\d)/i)
    .map(part => part.trim())
    .filter(Boolean);
}

function buildItemFromPart(part: string) {
  const quantityExpression = parseQuantityExpression(part);
  if (quantityExpression) {
    const foodName = normalizeSpaces(`${part.slice(0, quantityExpression.index)} ${part.slice(quantityExpression.index + quantityExpression.raw.length)}`);
    if (quantityExpression.kind === "valid") {
      return buildItem(foodName, quantityExpression.quantity, quantityExpression.unit, quantityExpression.expression);
    }
    return buildItem(foodName, null, null);
  }

  const quantity = parseQuantity(part);
  if (!quantity) {
    return buildItem(part, null, null);
  }
  const foodName = normalizeSpaces(`${part.slice(0, quantity.index)} ${part.slice(quantity.index + quantity.raw.length)}`);
  return buildItem(foodName, quantity.quantity, quantity.unit);
}

function parseAddItemsCommand(input: string, context: MealCommandContext): ParsedMealCommand | null {
  const actionMatch = input.match(/\b(?:adicionar|adiciona|adicione|incluir|inclui|inclua|registrar|registra|registre|acrescentar|acrescenta|acrescente)\b/i);
  if (!actionMatch) {
    return null;
  }

  const mealType = findMealType(input, context);
  const date = resolveCommandDate(input, context);
  const afterAction = input.slice((actionMatch.index ?? 0) + actionMatch[0].length);
  const mealPattern = "(?:caf[eé]\\s+da\\s+manh[aã]|almo[cç]o|jantar|lanche(?:\\s+da\\s+tarde)?|ceia)";
  const beforeMealMatch = afterAction.match(new RegExp(`^(.*?)\\s+(?:a|ao|à|no|na)\\s+(?:refei[cç][aã]o\\s+)?${mealPattern}(?:\\s+(?:de\\s+)?(?:hoje|ontem|anteontem|amanh[aã]))?\\s*$`, "i"));
  const afterMealMatch = afterAction.match(new RegExp(`^(?:a|ao|à|no|na)\\s+(?:refei[cç][aã]o\\s+)?${mealPattern}(?:\\s+(?:de\\s+)?(?:hoje|ontem|anteontem|amanh[aã]))?\\s+(.+)$`, "i"));
  const itemsText = beforeMealMatch?.[1] ?? afterMealMatch?.[1] ?? afterAction;
  const items = splitItemParts(itemsText).map(buildItemFromPart);
  const missingFields = [
    ...(mealType ? [] : ["mealType"]),
    ...(items.length ? [] : ["items"]),
  ];

  return {
    intent: "add_items_to_meal",
    mealType,
    date,
    items,
    confidence: missingFields.length || items.some(item => item.missingFields.length) ? 0.62 : 0.86,
    missingFields,
  };
}

function parseQuantityReplacement(input: string): ParsedMealCommand | null {
  const quantityPattern = `(${DECIMAL_NUMBER_PATTERN})\\s*(${QUANTITY_UNIT_PATTERN})`;
  const swapMatch = input.match(new RegExp(`\\b(?:trocar|troque|troca|mudar|alterar|corrigir)\\b\\s+${quantityPattern}\\s+(?:por|para)\\s+${quantityPattern}\\b`, "i"));
  if (swapMatch) {
    return {
      ...emptyCommand("replace_quantity"),
      previousQuantity: parseDecimalQuantity(swapMatch[1]),
      previousUnit: normalizeUnit(swapMatch[2]),
      nextQuantity: parseDecimalQuantity(swapMatch[3]),
      nextUnit: normalizeUnit(swapMatch[4]),
      confidence: 0.84,
      missingFields: [],
    };
  }

  const notThenCorrectMatch = input.match(new RegExp(`\\bn[aã]o\\s+(?:é|e|era)\\s+${quantityPattern}\\s*(?:,?\\s*)?(?:é|e|era)\\s+${quantityPattern}\\b`, "i"));
  if (notThenCorrectMatch) {
    return {
      ...emptyCommand("correct_quantity"),
      previousQuantity: parseDecimalQuantity(notThenCorrectMatch[1]),
      previousUnit: normalizeUnit(notThenCorrectMatch[2]),
      nextQuantity: parseDecimalQuantity(notThenCorrectMatch[3]),
      nextUnit: normalizeUnit(notThenCorrectMatch[4]),
      confidence: 0.84,
      missingFields: [],
    };
  }

  const correctThenNotMatch = input.match(new RegExp(`\\bera\\s+${quantityPattern}\\s*,?\\s*n[aã]o\\s+${quantityPattern}\\b`, "i"));
  if (correctThenNotMatch) {
    return {
      ...emptyCommand("correct_quantity"),
      previousQuantity: parseDecimalQuantity(correctThenNotMatch[3]),
      previousUnit: normalizeUnit(correctThenNotMatch[4]),
      nextQuantity: parseDecimalQuantity(correctThenNotMatch[1]),
      nextUnit: normalizeUnit(correctThenNotMatch[2]),
      confidence: 0.84,
      missingFields: [],
    };
  }

  return null;
}

function parseShortQuantityCorrection(input: string, context: MealCommandContext): ParsedMealCommand | null {
  const match = input.match(new RegExp(`\\b(?:corrigir\\s+para|corrija\\s+para|ajustar\\s+para|ajuste\\s+para)\\s+(${DECIMAL_NUMBER_PATTERN})\\s*(${QUANTITY_UNIT_PATTERN})\\b`, "i"));
  if (!match) {
    return null;
  }

  return {
    ...emptyCommand("correct_quantity"),
    mealType: context.recentMealType ?? null,
    date: context.recentDate ?? context.referenceDate ?? null,
    nextQuantity: parseDecimalQuantity(match[1]),
    nextUnit: normalizeUnit(match[2]),
    confidence: context.recentMealType || context.recentDate ? 0.74 : 0.66,
    missingFields: ["previousQuantity"],
  };
}

function parseItemReplacement(input: string): ParsedMealCommand | null {
  const match = input.match(/\b(?:trocar|troque|troca|substituir|substitua|mudar|alterar)\b\s+(.+?)\s+(?:por|para)\s+(.+)$/i)
    ?? input.match(/\bn[aã]o\s+(?:é|e|era)\s+(.+?)\s+(?:é|e|era)\s+(.+)$/i);
  if (!match || /\d/.test(match[1]) || /\d/.test(match[2])) {
    return null;
  }

  return {
    ...emptyCommand("replace_item"),
    items: [buildItem(match[2], null, null)],
    confidence: 0.72,
    missingFields: [],
  };
}

function parseRemoveItem(input: string): ParsedMealCommand | null {
  const match = input.match(/\b(?:remover|remove|remova|tirar|tira|excluir|exclui)\b\s+(?:o|a|os|as|de|do|da)?\s*(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    ...emptyCommand("remove_item"),
    items: [buildItem(match[1], null, null)],
    confidence: 0.68,
    missingFields: [],
  };
}

/**
 * Reconhece adições implícitas de alimento quando a mensagem contém uma
 * expressão aritmética de porção (ex: "120g - 30g") junto de um tipo de
 * refeição, mas SEM verbo de ação explícito.
 *
 * Exemplos cobertos:
 *   "120g - 30g frango ao almoço"         → 90g de frango no almoço
 *   "frango 120g - 30g no jantar"          → 90g de frango no jantar
 *   "150g + 50g de arroz no almoço"        → 200g de arroz no almoço
 *
 * Exige obrigatoriamente:
 *   1. Uma expressão aritmética válida (resultado > 0, unidades compatíveis)
 *   2. Um tipo de refeição identificável na mensagem
 *
 * Sem o tipo de refeição a mensagem é ambígua (pode ser correção de item
 * existente) e deve ser tratada por outro handler ou pelo LLM.
 */
function parseImplicitFoodAdditionCommand(input: string, context: MealCommandContext): ParsedMealCommand | null {
  const mealType = findMealType(input, context);
  if (!mealType) return null;

  const quantityExpression = parseQuantityExpression(input);
  if (!quantityExpression || quantityExpression.kind !== "valid") return null;

  // Extrai o nome do alimento removendo a expressão aritmética e o tipo de refeição
  const mealPattern = "(?:caf[eé]\\s+da\\s+manh[aã]|almo[cç]o|jantar|lanche(?:\\s+da\\s+tarde)?|ceia)";
  const withoutExpression = normalizeSpaces(
    `${input.slice(0, quantityExpression.index)} ${input.slice(quantityExpression.index + quantityExpression.raw.length)}`,
  );
  const withoutMeal = normalizeSpaces(
    withoutExpression
      .replace(new RegExp(`\\s*(?:a|ao|à|no|na)\\s+(?:refei[cç][aã]o\\s+)?${mealPattern}(?:\\s+(?:de\\s+)?(?:hoje|ontem|anteontem|amanh[aã]))?`, "i"), " ")
      .replace(new RegExp(`${mealPattern}(?:\\s+(?:de\\s+)?(?:hoje|ontem|anteontem|amanh[aã]))?\\s*`, "i"), " "),
  );
  const foodNameRaw = cleanFoodName(withoutMeal);
  if (!foodNameRaw) return null;

  const date = resolveCommandDate(input, context);
  const item = buildItem(foodNameRaw, quantityExpression.quantity, quantityExpression.unit, quantityExpression.expression);

  return {
    intent: "add_items_to_meal",
    mealType,
    date,
    items: [item],
    confidence: item.missingFields.length ? 0.62 : 0.88,
    missingFields: item.missingFields.length ? ["foodName"] : [],
  };
}

function parseBrandUpdate(input: string): ParsedMealCommand | null {
  const match = input.match(/\b(?:marca|brand)\b\s+(?:é|e|para|correta\s+é)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    ...emptyCommand("update_brand"),
    items: [{
      foodName: null,
      brand: normalizeSpaces(match[1]),
      quantity: null,
      unit: null,
      confidence: 0.7,
      missingFields: ["foodName"],
    }],
    confidence: 0.7,
    missingFields: ["foodName"],
  };
}

export function parseMealCommandFromWhatsApp(input: string, context: MealCommandContext = {}): ParsedMealCommand {
  const text = normalizeSpaces(input);
  if (!text) {
    return emptyCommand("unknown", ["intent"]);
  }

  return parseAddItemsCommand(text, context)
    ?? parseQuantityReplacement(text)
    ?? parseShortQuantityCorrection(text, context)
    ?? parseRemoveItem(text)
    ?? parseItemReplacement(text)
    ?? parseImplicitFoodAdditionCommand(text, context)
    ?? parseBrandUpdate(text)
    ?? emptyCommand("unknown", ["intent"]);
}
