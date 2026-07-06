import { roundNutritionValue } from "../shared/mealTotals";
import { normalizeMeasurementUnit } from "../shared/measurementUnits";
import type { ExplicitQuantity, LlmItem, ParsedFoodText } from "./nutritionEngineTypes";

export const QUANTITY_UNIT_PATTERN = "g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|un|unidades?|fatias?|colheres? de sopa|colheres? de ch[aá]|x[ií]caras?|copos?|doses?|scoops?|long\\s*neck|longneck|latas?|garrafas?|por[cç][oõ]es?|por[cç][aã]o";

const QUANTITY_EXPRESSION_OPERATOR_PATTERN = "x|X|\\*|/|÷|\\+|-|dividid[ao]\\s+por|dividir\\s+por";
const MAX_QUANTITY_EXPRESSION_OPERATORS = 5;

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
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function tokenizeQuantityExpression(expressionText: string) {
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
        return null;
      }
      terms.push({
        value,
        unit: match[2] ? normalizeUnit(match[2]) : undefined,
      });
      continue;
    }

    const operator = normalizeArithmeticOperator(match[3] || "");
    if (!operator) {
      return null;
    }
    operators.push(operator);
  }

  if (expressionText.replace(/\s+/g, "") !== consumed.replace(/\s+/g, "")) {
    return null;
  }

  if (terms.length < 2 || operators.length !== terms.length - 1 || operators.length > MAX_QUANTITY_EXPRESSION_OPERATORS) {
    return null;
  }

  return { terms, operators };
}

function evaluateQuantityExpression(expressionText: string): QuantityExpression | null {
  const tokenized = tokenizeQuantityExpression(expressionText);
  if (!tokenized) {
    return null;
  }

  const units = Array.from(new Set(tokenized.terms.map(term => term.unit).filter((unit): unit is string => Boolean(unit))));
  if (units.length !== 1) {
    return null;
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
      return null;
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
    return null;
  }

  const quantity = roundNutritionValue(result);
  const estimatedGrams = estimateGramsFromQuantity(quantity, unit);
  return {
    quantity,
    unit,
    estimatedGrams: estimatedGrams === undefined ? undefined : roundNutritionValue(estimatedGrams),
  };
}

function parseLeadingQuantityExpression(value: string) {
  const numberWithOptionalUnit = `\\d+(?:[,.]\\d+)?\\s*(?:${QUANTITY_UNIT_PATTERN})?`;
  const expressionPattern = new RegExp(
    `^((?:${numberWithOptionalUnit})(?:\\s*(?:${QUANTITY_EXPRESSION_OPERATOR_PATTERN})\\s*${numberWithOptionalUnit}){1,${MAX_QUANTITY_EXPRESSION_OPERATORS}})\\s+(?:de\\s+)?(.+)$`,
    "iu",
  );
  const match = value.trim().match(expressionPattern);
  if (!match) {
    return null;
  }

  const expression = evaluateQuantityExpression(match[1]);
  const foodName = cleanFoodName(match[2]);
  if (!expression || !foodName) {
    return null;
  }

  return {
    foodName,
    ...expression,
    portionText: buildPortionText(expression.quantity, expression.unit),
  };
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

export function extractExplicitQuantities(sourceText: string): ExplicitQuantity[] {
  const expression = parseLeadingQuantityExpression(sourceText);
  if (expression?.quantity && expression.unit) {
    return [{
      quantity: expression.quantity,
      unit: expression.unit,
      estimatedGrams: expression.estimatedGrams,
    }];
  }

  const matches = Array.from(sourceText.matchAll(new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${QUANTITY_UNIT_PATTERN})\\b`, "gi")));
  return matches
    .map(match => {
      const quantity = parseDecimalNumber(match[1]);
      const unit = normalizeUnit(match[2]);
      const estimatedGrams = estimateGramsFromQuantity(quantity, unit);
      return {
        quantity: roundNutritionValue(quantity),
        unit,
        estimatedGrams: estimatedGrams === undefined ? undefined : roundNutritionValue(estimatedGrams),
      };
    })
    .filter(item => Number.isFinite(item.quantity) && item.quantity > 0);
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

  return {
    ...item,
    foodName: parsed.foodName || cleanFoodName(item.foodName),
    quantity,
    unit,
    portionText: parsed.portionText ?? item.portionText ?? buildPortionText(quantity, unit),
    servings: parsed.estimatedGrams ? Math.max(parsed.estimatedGrams / 100, 0.25) : item.servings,
    estimatedGrams,
  };
}
