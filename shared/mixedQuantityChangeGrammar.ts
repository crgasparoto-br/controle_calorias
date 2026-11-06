import {
  normalizeQuantityInputText,
  normalizeMeasurementUnit,
} from "./measurementUnits";
import {
  COUNTABLE_QUANTITY_PATTERN,
  joinUnitWords,
  parseCountableQuantity,
} from "./quantityUnitVocabulary";

const MEALS = [
  "cafe da manha",
  "almoco",
  "jantar",
  "lanche da tarde",
  "lanche",
  "ceia",
] as const;

export type MixedIncrementUnit = "g" | "ml" | "fatia" | "unidade" | null;

export type ParsedMixedIncrementOperation = {
  quantity: number;
  unit: MixedIncrementUnit;
  targetFood: string | null;
  sourceSegment: string;
  inheritedUnit: boolean;
};

export type ParsedMixedIncrementCommand = {
  mealLabel: string | null;
  operations: ParsedMixedIncrementOperation[];
  unparsedSegments: string[];
};

const INCREMENT_VERB =
  /\b(?:somar|soma|some|adicionar|adiciona|adicione|acrescentar|acrescenta|acrescente|colocar\s+mais|coloca\s+mais|coloque\s+mais|aumentar|aumenta|aumente)\b/i;
const EXPLICIT_UNIT = joinUnitWords([
  "gramas",
  "mililitrosCompact",
  "fatias",
  "unidades",
]);
const COUNTABLE_UNIT = new Set<MixedIncrementUnit>(["fatia", "unidade"]);
const PREPOSITION = "(?:aos|dos|das|ao|as|os|no|na|do|da|de|a|o)";

function toComparisonText(value: string) {
  return normalizeQuantityInputText(value);
}

function labelRegex(label: string) {
  return label.replace(/\s+/g, "\\s+");
}

function mealFromText(text: string) {
  return (
    MEALS.find(label =>
      new RegExp(
        `\\b(?:do|da|de|no|na|ao|a|para)\\s+(?:refeicao\\s+)?${labelRegex(label)}\\b`
      ).test(text)
    ) ?? null
  );
}

function stripMealSuffix(value: string, mealLabel: string | null) {
  if (!mealLabel) return value;
  return value
    .replace(
      new RegExp(
        `\\s+(?:do|da|de|no|na|ao|a|para)\\s+(?:refeicao\\s+)?${labelRegex(mealLabel)}\\s*$`,
        "i"
      ),
      ""
    )
    .trim();
}

function cleanTargetName(value: string | null, mealLabel: string | null) {
  if (!value) return null;
  let cleaned = value
    .replace(/^\s*(?:o|a|os|as|ao|aos|no|na|do|da|de|dos|das)\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  cleaned = stripMealSuffix(cleaned, mealLabel);
  return cleaned || null;
}

function hasDanglingCoordinator(value: string) {
  return /\be\b/i.test(value);
}

function normalizeUnit(value: string): MixedIncrementUnit {
  const normalized = normalizeMeasurementUnit(value);
  if (normalized === "g" || normalized === "ml" || normalized === "fatia")
    return normalized;
  if (normalized === "un") return "unidade";
  return null;
}

function parseQuantity(value: string) {
  const parsed = parseCountableQuantity(value);
  return parsed !== null && Number.isFinite(parsed) ? parsed : Number.NaN;
}

function splitCoordinatedSegments(text: string) {
  const quantityStart = new RegExp(
    `\\s+e\\s+(?=${COUNTABLE_QUANTITY_PATTERN}(?:\\s*${EXPLICIT_UNIT}\\b|\\b(?:\\s|$)))`,
    "i"
  );
  return (
    text
      // Preserve a decimal comma only when it is directly between digits.
      .split(/(?<!\d),|,(?!\d)|;/)
      .flatMap(part => part.split(quantityStart))
      .map(segment => segment.trim())
      .filter(Boolean)
  );
}

function removeLeadingListConjunction(segment: string) {
  return segment.replace(/^e\s+/i, "").trim();
}

function removeLeadingVerb(segment: string) {
  const prefix = new RegExp(
    `^(?:por\\s+favor\\s+)?${INCREMENT_VERB.source}\\s+`,
    "i"
  );
  return segment.replace(prefix, "").trim();
}

function isStandaloneMealReference(segment: string, mealLabel: string | null) {
  if (!mealLabel) return false;
  return new RegExp(
    `^(?:do|da|de|no|na|ao|a|para)(?:\\s+refeicao)?\\s+${labelRegex(mealLabel)}$`,
    "i"
  ).test(segment);
}

function isSupportedIncrementCandidate(segment: string) {
  const signedQuantity = `(?:[+-]?\\d+(?:[,.]\\d+)?|${COUNTABLE_QUANTITY_PATTERN})`;
  return (
    new RegExp(`^${signedQuantity}\\s*${EXPLICIT_UNIT}\\b`, "i").test(
      segment
    ) ||
    new RegExp(
      `^(${COUNTABLE_QUANTITY_PATTERN})\\b\\s+${PREPOSITION}\\b`,
      "i"
    ).test(segment)
  );
}

export function parseQuantityChange(
  text: string
): ParsedMixedIncrementCommand | null {
  const comparisonText = toComparisonText(text);
  if (!INCREMENT_VERB.test(comparisonText)) return null;

  const mealLabel = mealFromText(comparisonText);
  const rawSegments = splitCoordinatedSegments(comparisonText);
  const operations: ParsedMixedIncrementOperation[] = [];
  const unparsedSegments: string[] = [];
  let previousExplicitCountableUnit: MixedIncrementUnit = null;
  let hasSupportedIncrementCandidate = false;

  for (const [index, rawSegment] of rawSegments.entries()) {
    const segment = removeLeadingVerb(
      index === 0 ? rawSegment : removeLeadingListConjunction(rawSegment)
    );
    if (!segment || isStandaloneMealReference(segment, mealLabel)) continue;
    hasSupportedIncrementCandidate ||= isSupportedIncrementCandidate(segment);

    // A dangling coordinator is evidence of an unconsumed operation, not part
    // of the previous food name.
    if (/\be\s*$/i.test(segment)) {
      unparsedSegments.push(segment);
      previousExplicitCountableUnit = null;
      continue;
    }

    const explicit = segment.match(
      new RegExp(
        `^(${COUNTABLE_QUANTITY_PATTERN})\\s*(${EXPLICIT_UNIT})\\b(?:\\s+(?:${PREPOSITION}\\s+)?)?(.+)?$`,
        "i"
      )
    );
    if (explicit) {
      const quantity = parseQuantity(explicit[1]);
      const unit = normalizeUnit(explicit[2]);
      const targetName = cleanTargetName(
        explicit[3]?.trim() ?? null,
        mealLabel
      );
      if (
        Number.isFinite(quantity) &&
        quantity > 0 &&
        unit &&
        targetName &&
        !hasDanglingCoordinator(targetName)
      ) {
        operations.push({
          quantity,
          unit,
          targetFood: targetName,
          sourceSegment: segment,
          inheritedUnit: false,
        });
        previousExplicitCountableUnit = COUNTABLE_UNIT.has(unit) ? unit : null;
        continue;
      }
    }

    const elliptical = segment.match(
      new RegExp(
        `^(${COUNTABLE_QUANTITY_PATTERN})\\b\\s+${PREPOSITION}\\s+(.+)$`,
        "i"
      )
    );
    if (elliptical) {
      const quantity = parseQuantity(elliptical[1]);
      const targetName = cleanTargetName(
        elliptical[2]?.trim() ?? null,
        mealLabel
      );
      const inheritedUnit = previousExplicitCountableUnit;
      if (
        Number.isFinite(quantity) &&
        quantity > 0 &&
        targetName &&
        !hasDanglingCoordinator(targetName)
      ) {
        operations.push({
          quantity,
          unit: inheritedUnit,
          targetFood: targetName,
          sourceSegment: segment,
          inheritedUnit: Boolean(inheritedUnit),
        });
        previousExplicitCountableUnit = null;
        continue;
      }
    }

    // Keep every nonempty unconsumed candidate. The public intent decides
    // whether a command with both valid operations and residual must fail closed.
    unparsedSegments.push(segment);
    previousExplicitCountableUnit = null;
  }

  return operations.length || hasSupportedIncrementCandidate
    ? { mealLabel, operations, unparsedSegments }
    : null;
}
