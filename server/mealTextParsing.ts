import { roundNutritionValue } from "../shared/mealTotals";
import { normalizeMeasurementUnit } from "../shared/measurementUnits";
import type { ExplicitQuantity, LlmItem, ParsedFoodText } from "./nutritionEngineTypes";
import { COUNTABLE_QUANTITY_PATTERN, parseCountableQuantity, isSpoonUnitPrefix, stripConsumptionPreface } from "../shared/quantityUnitVocabulary";

export const QUANTITY_UNIT_PATTERN =
  "g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|un|unidades?|fatias?|colher(?:es)?(?: de sopa| de ch[aá])?|x[ií]caras?|copos?|doses?|scoops?|long\\s*neck|longneck|latas?|garrafas?|por[cç][oõ]es?|por[cç][aã]o";

const QUANTITY_EXPRESSION_OPERATOR_PATTERN = "x|X|\\*|/|÷|\\+|-|dividid[ao]\\s+por|dividir\\s+por";
const MAX_QUANTITY_EXPRESSION_OPERATORS = 5;
const FOOD_NAME_LOWERCASE_CONNECTORS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "com",
  "e",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "ao",
  "aos",
  "à",
  "às",
  "para",
  "por",
]);

const COORDINATED_BEVERAGE_COMPLEMENT_START = new RegExp(
  `^(?:(?:${COUNTABLE_QUANTITY_PATTERN})\\s*(?:g|gr|gramas?|kg|quilos?|mg|miligramas?|colher(?:es)? de sopa|colher(?:es)? de cha|saches?|pacotes?)(?:\\s+(?:adicionais?|extras?|a\\s+mais))?\\s+(?:de\\s+)?)?(?:acucar|leite(?:\\s+condensado)?|mel|creme|chantilly|chocolate|achocolatad[oa])\\b`,
  "i",
);

type QuantityExpressionErrorCode =
  | "invalid_syntax"
  | "too_many_operators"
  | "conflicting_units"
  | "missing_unit"
  | "division_by_zero"
  | "non_positive_result";

export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeForMatching(value: string) {
  return ` ${normalizeText(value).replace(/-/g, " ").replace(/\s+/g, " ")} `;
}

export function normalizedTokenIncludes(haystack: string, needle: string) {
  const normalizedNeedle = normalizeForMatching(needle).trim();
  return Boolean(normalizedNeedle) && haystack.includes(` ${normalizedNeedle} `);
}

export function cleanFoodName(value: string) {
  return value
    // Keep decimal separators between digits so `1,5 fatias` remains a
    // quantity-bearing expression instead of becoming `1 5 fatias`.
    .replace(/[^\p{L}\p{N}\s.,-]/gu, " ")
    .replace(/(?<!\d)[.,]|[.,](?!\d)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasLetters(value: string) {
  return /\p{L}/u.test(value);
}

function isPreservedUppercaseToken(value: string) {
  return hasLetters(value) && value === value.toLocaleUpperCase("pt-BR") && value !== value.toLocaleLowerCase("pt-BR");
}

function titleCaseFoodNameWord(value: string, isFirstWord: boolean) {
  const lower = value.toLocaleLowerCase("pt-BR");
  if (!isFirstWord && FOOD_NAME_LOWERCASE_CONNECTORS.has(lower)) {
    return lower;
  }
  if (isPreservedUppercaseToken(value)) {
    return value;
  }

  return lower.replace(/\p{L}[\p{L}\p{M}]*/gu, match => (
    match.charAt(0).toLocaleUpperCase("pt-BR") + match.slice(1)
  ));
}

export function formatFoodNameTitleCase(value: string) {
  const cleaned = cleanFoodName(value);
  if (!cleaned) {
    return cleaned;
  }

  let wordIndex = 0;
  return cleaned
    .split(/\s+/)
    .map(word => word.split("-").map(segment => {
      if (!segment) {
        return segment;
      }
      const formatted = titleCaseFoodNameWord(segment, wordIndex === 0);
      wordIndex += 1;
      return formatted;
    }).join("-"))
    .join(" ");
}

export function parseDecimalNumber(value: string) {
  return Number(value.replace(",", "."));
}

export function normalizeUnit(value: string) {
  if (!value) return "porção";
  return normalizeMeasurementUnit(value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

export function formatQuantityForPortion(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

export function buildPortionText(quantity: number, unit: string) {
  return `${formatQuantityForPortion(quantity)} ${unit}`;
}

function shouldPreserveCoordinatedBeverageComplement(left: string, right: string) {
  const normalizedLeft = normalizeText(left).replace(/-/g, " ").replace(/\s+/g, " ");
  const normalizedRight = normalizeText(right).replace(/-/g, " ").replace(/\s+/g, " ");
  return /\b(?:cafe|cha)\b/.test(normalizedLeft)
    && /\bcom\b/.test(normalizedLeft)
    && COORDINATED_BEVERAGE_COMPLEMENT_START.test(normalizedRight);
}

function splitFoodConjunctions(value: string) {
  const parts = value.split(/\be\b/gi).map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) return parts;

  const segments: string[] = [];
  let current = parts[0];
  for (const next of parts.slice(1)) {
    if (shouldPreserveCoordinatedBeverageComplement(current, next)) {
      current = `${current} e ${next}`;
      continue;
    }
    segments.push(current);
    current = next;
  }
  segments.push(current);
  return segments;
}

export function splitFoodTextSegments(sourceText: string) {
  return sourceText
    // A vírgula entre dígitos é separador decimal (`22,5 g de mortadela`), não
    // separador de itens. Sem essa guarda o texto virava dois alimentos e o
    // primeiro era registrado a partir do próprio número (`22` → arroz). A
    // guarda é a mesma de `cleanFoodName`: a vírgula só permanece quando está
    // entre dois dígitos, então `alimento 1, alimento 2` continua separando.
    .split(/(?<!\d),|,(?!\d)|;|\+(?!\s*\d)|\n/gi)
    .flatMap(splitFoodConjunctions)
    .map(value => value.trim())
    .filter(Boolean);
}

export function estimateGramsFromQuantity(quantity: number, unit: string) {
  switch (normalizeUnit(unit)) {
    case "kg":
      return quantity * 1000;
    case "mg":
      return quantity / 1000;
    case "g":
    case "ml":
      return quantity;
    case "l":
      return quantity * 1000;
    default:
      return undefined;
  }
}

type QuantityExpressionTerm = {
  value: number;
  unit?: string;
};

type QuantityExpression = {
  quantity: number;
  unit: string;
  estimatedGrams?: number;
};

type QuantityExpressionTokenization =
  | { ok: true; terms: QuantityExpressionTerm[]; operators: string[] }
  | { ok: false; code: QuantityExpressionErrorCode };

type QuantityExpressionEvaluation =
  | { ok: true; expression: QuantityExpression }
  | { ok: false; code: QuantityExpressionErrorCode };

function normalizeArithmeticOperator(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "x" || normalized === "*") return "*";
  if (normalized === "/" || normalized === "÷" || normalized.startsWith("divid")) return "/";
  if (normalized === "+") return "+";
  if (normalized === "-") return "-";
  return null;
}

function tokenizeQuantityExpression(expressionText: string): QuantityExpressionTokenization {
  const tokenPattern = new RegExp(
    `(\\d+(?:[,.]\\d+)?)(?:\\s*(${QUANTITY_UNIT_PATTERN}))?|(${QUANTITY_EXPRESSION_OPERATOR_PATTERN})`,
    "giu",
  );
  const terms: QuantityExpressionTerm[] = [];
  const operators: string[] = [];
  let consumed = "";

  for (const match of expressionText.matchAll(tokenPattern)) {
    consumed += match[0];
    if (match[1]) {
      const value = parseDecimalNumber(match[1]);
      if (!Number.isFinite(value)) {
        return { ok: false, code: "invalid_syntax" };
      }
      terms.push({
        value,
        unit: match[2] ? normalizeUnit(match[2]) : undefined,
      });
      continue;
    }

    const operator = normalizeArithmeticOperator(match[3] || "");
    if (!operator) {
      return { ok: false, code: "invalid_syntax" };
    }
    operators.push(operator);
  }

  if (expressionText.replace(/\s+/g, "") !== consumed.replace(/\s+/g, "")) {
    return { ok: false, code: "invalid_syntax" };
  }

  if (terms.length < 2 || operators.length !== terms.length - 1) {
    return { ok: false, code: "invalid_syntax" };
  }

  if (operators.length > MAX_QUANTITY_EXPRESSION_OPERATORS) {
    return { ok: false, code: "too_many_operators" };
  }

  return { ok: true, terms, operators };
}

function evaluateQuantityExpression(expressionText: string): QuantityExpressionEvaluation {
  if (!expressionText.trim()) {
    return { ok: false, code: "invalid_syntax" };
  }
  const tokenized = tokenizeQuantityExpression(expressionText);
  if (!tokenized.ok) {
    return tokenized;
  }

  const units = Array.from(new Set(tokenized.terms.map(term => term.unit).filter((unit): unit is string => Boolean(unit))));
  if (units.length === 0) {
    return { ok: false, code: "missing_unit" };
  }
  if (units.length > 1) {
    return { ok: false, code: "conflicting_units" };
  }

  const unit = units[0];
  const values = tokenized.terms.map(term => term.value);
  const operators = [...tokenized.operators];

  for (let index = 0; index < operators.length;) {
    const operator = operators[index];
    if (operator !== "*" && operator !== "/") {
      index += 1;
      continue;
    }

    const left = values[index];
    const right = values[index + 1];
    if (operator === "/" && right === 0) {
      return { ok: false, code: "division_by_zero" };
    }

    values.splice(index, 2, operator === "*" ? left * right : left / right);
    operators.splice(index, 1);
  }

  let result = values[0];
  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index];
    const value = values[index + 1];
    result = operator === "+" ? result + value : result - value;
  }

  if (!Number.isFinite(result) || result <= 0) {
    return { ok: false, code: "non_positive_result" };
  }

  const quantity = roundNutritionValue(result);
  const estimatedGrams = estimateGramsFromQuantity(quantity, unit);
  return {
    ok: true,
    expression: {
      quantity,
      unit,
      estimatedGrams: estimatedGrams === undefined ? undefined : roundNutritionValue(estimatedGrams),
    },
  };
}

function findLeadingQuantityExpression(value: string) {
  const numberWithOptionalUnit = `\\d+(?:[,.]\\d+)?\\s*(?:${QUANTITY_UNIT_PATTERN})?`;
  const expressionPattern = new RegExp(
    `^((?:${numberWithOptionalUnit})(?:\\s*(?:${QUANTITY_EXPRESSION_OPERATOR_PATTERN})\\s*${numberWithOptionalUnit})+)\\s+(?:de\\s+)?(.+)$`,
    "iu",
  );
  const match = value.trim().match(expressionPattern);
  if (!match) {
    return null;
  }

  return {
    expressionText: match[1],
    foodName: cleanFoodName(match[2]),
  };
}

function parseLeadingQuantityExpression(value: string) {
  const match = findLeadingQuantityExpression(value);
  if (!match) {
    return null;
  }

  const evaluation = evaluateQuantityExpression(match.expressionText);
  if (!evaluation.ok || !match.foodName) {
    return null;
  }

  return {
    foodName: match.foodName,
    ...evaluation.expression,
    portionText: buildPortionText(evaluation.expression.quantity, evaluation.expression.unit),
  };
}

function buildQuantityExpressionClarification(code: QuantityExpressionErrorCode) {
  if (code === "division_by_zero") {
    return "Não consegui calcular essa quantidade porque há divisão por zero. Pode reenviar a quantidade do alimento de outro jeito?";
  }
  if (code === "non_positive_result") {
    return "Não consegui registrar essa quantidade porque o cálculo ficou zero ou negativo. Pode enviar uma quantidade maior que zero?";
  }
  if (code === "too_many_operators") {
    return "Não consegui calcular essa quantidade porque a expressão tem operações demais. Pode simplificar a quantidade do alimento?";
  }
  if (code === "conflicting_units") {
    return "Não consegui calcular essa quantidade porque a expressão mistura unidades diferentes. Pode enviar a quantidade usando uma única unidade?";
  }
  if (code === "missing_unit") {
    return "Não consegui identificar a unidade da quantidade. Pode reenviar informando g, ml, unidade ou outra medida do alimento?";
  }
  return "Não consegui entender a conta usada na quantidade do alimento. Pode reenviar a quantidade de um jeito mais simples?";
}

function getQuantityExpressionClarificationForSegment(value: string) {
  const match = findLeadingQuantityExpression(value);
  if (!match) {
    return null;
  }

  const evaluation = evaluateQuantityExpression(match.expressionText);
  if (evaluation.ok && match.foodName) {
    return null;
  }

  return buildQuantityExpressionClarification(evaluation.ok ? "invalid_syntax" : evaluation.code);
}

export function getQuantityExpressionClarification(value: string) {
  const segments = splitFoodTextSegments(value);
  const candidates = segments.length > 1 ? segments : [value];

  for (const candidate of candidates) {
    const clarification = getQuantityExpressionClarificationForSegment(candidate);
    if (clarification) {
      return clarification;
    }
  }

  return null;
}

export function parseCountableQuantityPrefix(value: string) {
  const words = value.trim().split(" ").filter(Boolean);
  const quantity = parseCountableQuantity(words[0] ?? "");
  if (!quantity || words.length < 2) return null;

  const remainderWords =
    words[1]?.toLowerCase() === "de" ? words.slice(2) : words.slice(1);
  const remainder = remainderWords.join(" ");
  return remainder ? { quantity, remainder } : null;
}

export function parseFoodText(value: string): ParsedFoodText {
  const expression = parseLeadingQuantityExpression(value);
  if (expression) {
    return expression;
  }

  const cleaned = cleanFoodName(value);
  const quantityPattern = `(\\d+(?:[,.]\\d+)?)\\s*(${QUANTITY_UNIT_PATTERN})`;
  const leadingMatch = cleaned.match(new RegExp(`^${quantityPattern}\\s+(?:de\\s+)?(.+)$`, "i"));
  const trailingMatch = cleaned.match(new RegExp(`^(.+?)\\s+${quantityPattern}$`, "i"));
  const match = leadingMatch || trailingMatch;

  if (!match) {
    return { foodName: cleaned };
  }

  const quantity = parseDecimalNumber(leadingMatch ? match[1] : match[2]);
  const unit = normalizeUnit(leadingMatch ? match[2] : match[3]);
  const foodName = cleanFoodName(leadingMatch ? match[3] : match[1]);

  if (!foodName || Number.isNaN(quantity) || quantity <= 0) {
    return { foodName: cleaned };
  }

  const estimatedGrams = estimateGramsFromQuantity(quantity, unit);

  return {
    foodName,
    quantity: roundNutritionValue(quantity),
    unit,
    portionText: buildPortionText(roundNutritionValue(quantity), unit),
    estimatedGrams: estimatedGrams === undefined ? undefined : roundNutritionValue(estimatedGrams),
  };
}

/**
 * Only a known meal-registration preface may be removed for quantity parsing.
 * The caller retains the original text/spans for semantic provenance.
 * Do not guess a food from unrelated prose or an unquantified statement.
 */
export function unwrapMealQuantityPreface(segment: string) {
  const candidate = stripConsumptionPreface(segment);
  if (!candidate) return segment;
  // A spoken number must be decoded before checking the spoon guard. This
  // stays parser-only: food identity, original text and provenance are intact.
  const spokenCount = parseCountableQuantityPrefix(candidate);
  const quantityText = spokenCount
    ? `${spokenCount.quantity} ${spokenCount.remainder}`
    : candidate;
  const parsed = parseFoodText(quantityText);
  // V1 compatibility is confined to spoon amounts; original input/span is retained.
  return parsed.quantity && parsed.unit && isSpoonUnitPrefix(parsed.unit)
    ? quantityText
    : segment;
}

export function extractExplicitQuantityFoodSegments(sourceText: string): Array<ExplicitQuantity & { foodName: string }> {
  const items: Array<ExplicitQuantity & { foodName: string }> = [];

  for (const segment of splitFoodTextSegments(sourceText)) {
    const parsed = parseFoodText(unwrapMealQuantityPreface(segment));
    if (!parsed.quantity || !parsed.unit) {
      continue;
    }

    const item: ExplicitQuantity & { foodName: string } = {
      foodName: parsed.foodName,
      quantity: parsed.quantity,
      unit: parsed.unit,
    };
    if (parsed.estimatedGrams !== undefined) {
      item.estimatedGrams = parsed.estimatedGrams;
    }
    items.push(item);
  }

  return items;
}

export function extractExplicitQuantities(
  sourceText: string
): ExplicitQuantity[] {
  const expression = parseLeadingQuantityExpression(sourceText);
  if (expression?.quantity && expression.unit) {
    return [
      {
        quantity: expression.quantity,
        unit: expression.unit,
        estimatedGrams: expression.estimatedGrams,
      },
    ];
  }

  const items: ExplicitQuantity[] = [];
  for (const segment of splitFoodTextSegments(sourceText)) {
    const words = segment.trim().split(" ").filter(Boolean);
    for (let index = 0; index < words.length; index += 1) {
      const candidate = words.slice(index).join(" ");
      const parsed = parseFoodText(`${candidate} x`);
      if (!parsed.quantity || !parsed.unit) continue;

      const remainder = parsed.foodName.slice(0, -2);
      const cleanedCandidate = cleanFoodName(candidate);
      const consumedPrefix = cleanedCandidate.slice(
        0,
        cleanedCandidate.length - remainder.length
      );
      const consumedWordCount = consumedPrefix
        .trim()
        .split(" ")
        .filter(Boolean).length;
      items.push({
        quantity: parsed.quantity,
        unit: parsed.unit,
        estimatedGrams: parsed.estimatedGrams,
      });
      index += consumedWordCount - 1;
    }
  }

  return items.filter(
    item => Number.isFinite(item.quantity) && item.quantity > 0
  );
}

export function parseQuantityUnitFromPortionText(portionText: string) {
  const match = portionText.trim().match(/^(\d+(?:[,.]\d+)?)(?:\s+(.+))?$/u);
  if (!match) {
    return null;
  }

  const quantity = Number(match[1].replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return {
    quantity,
    unit: match[2]?.trim() || "porção",
  };
}

export function normalizeLlmItem(item: LlmItem): LlmItem {
  const parsed = parseFoodText(item.foodName);
  const quantityFromItem = Number(item.quantity);
  const quantity = parsed.quantity
    ?? (Number.isFinite(quantityFromItem) && quantityFromItem > 0 ? quantityFromItem : 1);
  const unit = normalizeUnit(parsed.unit ?? item.unit ?? "porção");
  const estimatedFromQuantity = estimateGramsFromQuantity(quantity, unit);
  const estimatedGrams = parsed.estimatedGrams ?? (item.estimatedGrams > 0 ? item.estimatedGrams : (estimatedFromQuantity ?? 0));
  const foodName = formatFoodNameTitleCase(parsed.foodName || cleanFoodName(item.foodName));
  const brand = item.brand == null ? item.brand : formatFoodNameTitleCase(item.brand);

  return {
    ...item,
    foodName,
    brand,
    quantity,
    unit,
    portionText: parsed.portionText ?? item.portionText ?? buildPortionText(quantity, unit),
    servings: parsed.estimatedGrams ? Math.max(parsed.estimatedGrams / 100, 0.25) : item.servings,
    estimatedGrams,
  };
}
