import { normalizeMeasurementUnit } from "../../../../shared/measurementUnits";
import { joinUnitWords } from "../quantityUnitVocabulary";

const MEALS = ["cafe da manha", "almoco", "jantar", "lanche da tarde", "lanche", "ceia"] as const;

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

const INCREMENT_VERB = /\b(?:somar|soma|some|adicionar|adiciona|adicione|acrescentar|acrescenta|acrescente|colocar\s+mais|coloca\s+mais|coloque\s+mais|aumentar|aumenta|aumente)\b/i;
const NUMBER_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2 };
const EXPLICIT_UNIT = joinUnitWords(["gramas", "mililitros", "fatias", "unidades"]);
const COUNTABLE_UNIT = new Set<MixedIncrementUnit>(["fatia", "unidade"]);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelRegex(label: string) {
  return label.replace(/\s+/g, "\\s+");
}

function mealFromText(text: string) {
  return MEALS.find(label => new RegExp(`\\b(?:do|da|de|no|na|ao|a|para)\\s+(?:refeicao\\s+)?${labelRegex(label)}\\b`).test(text)) ?? null;
}

function stripMealSuffix(value: string, mealLabel: string | null) {
  if (!mealLabel) return value;
  return value.replace(
    new RegExp(`\\s+(?:do|da|de|no|na|ao|a|para)\\s+(?:refeicao\\s+)?${labelRegex(mealLabel)}\\s*$`, "i"),
    "",
  ).trim();
}

function cleanFood(value: string | null, mealLabel: string | null) {
  if (!value) return null;
  let cleaned = value
    .replace(/^\s*(?:o|a|os|as|ao|aos|no|na|do|da|de|dos|das)\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  cleaned = stripMealSuffix(cleaned, mealLabel);
  return cleaned || null;
}

function normalizeUnit(value: string): MixedIncrementUnit {
  const normalized = normalizeMeasurementUnit(value);
  if (normalized === "g" || normalized === "ml" || normalized === "fatia") return normalized;
  if (normalized === "un") return "unidade";
  return null;
}

function parseQuantity(value: string) {
  const normalized = normalize(value);
  if (/^\d+(?:[,.]\d+)?$/.test(normalized)) return Number(normalized.replace(",", "."));
  return NUMBER_WORDS[normalized] ?? Number.NaN;
}

function splitCoordinatedSegments(text: string) {
  return text
    .split(/\s*[,;]\s*/)
    .flatMap(part => part.split(/\s+e\s+(?=(?:\d+(?:[,.]\d+)?|um|uma|dois|duas)\b)/i))
    .map(segment => segment.trim())
    .filter(Boolean);
}

function removeLeadingVerb(segment: string) {
  const match = segment.match(INCREMENT_VERB);
  if (!match || match.index === undefined) return segment.trim();
  return segment.slice(match.index + match[0].length).trim();
}

function looksLikeIncrementSegment(segment: string) {
  return /^(?:\d+(?:[,.]\d+)?|um|uma|dois|duas)\b/i.test(segment.trim());
}

export function parseMixedMealItemIncrementCommand(text: string): ParsedMixedIncrementCommand | null {
  const normalizedText = normalize(text);
  if (!INCREMENT_VERB.test(normalizedText)) return null;

  const mealLabel = mealFromText(normalizedText);
  const rawSegments = splitCoordinatedSegments(normalizedText);
  const operations: ParsedMixedIncrementOperation[] = [];
  const unparsedSegments: string[] = [];
  let previousExplicitCountableUnit: MixedIncrementUnit = null;

  for (const [index, rawSegment] of rawSegments.entries()) {
    const segment = index === 0 ? removeLeadingVerb(rawSegment) : rawSegment;
    const explicit = segment.match(
      new RegExp(`^(\\d+(?:[,.]\\d+)?|um|uma|dois|duas)\\s*(${EXPLICIT_UNIT})\\b(?:\\s+(?:(?:aos|dos|das|ao|as|os|no|na|do|da|de|a|o)\\s+)?)?(.+)?$`, "i"),
    );
    if (explicit) {
      const quantity = parseQuantity(explicit[1]);
      const unit = normalizeUnit(explicit[2]);
      const targetFood = cleanFood(explicit[3]?.trim() ?? null, mealLabel);
      if (Number.isFinite(quantity) && quantity > 0 && unit && targetFood) {
        operations.push({ quantity, unit, targetFood, sourceSegment: segment, inheritedUnit: false });
        previousExplicitCountableUnit = COUNTABLE_UNIT.has(unit) ? unit : null;
        continue;
      }
    }

    const elliptical = segment.match(
      /^(\d+(?:[,.]\d+)?|um|uma|dois|duas)\b(?:\s+(?:(?:aos|dos|das|ao|as|os|no|na|do|da|de|a|o)\s+))(.+)$/i,
    );
    if (elliptical) {
      const quantity = parseQuantity(elliptical[1]);
      const targetFood = cleanFood(elliptical[2]?.trim() ?? null, mealLabel);
      const inheritedUnit = previousExplicitCountableUnit;
      if (Number.isFinite(quantity) && quantity > 0 && targetFood) {
        operations.push({
          quantity,
          unit: inheritedUnit,
          targetFood,
          sourceSegment: segment,
          inheritedUnit: Boolean(inheritedUnit),
        });
        previousExplicitCountableUnit = null;
        continue;
      }
    }

    if (looksLikeIncrementSegment(segment)) {
      unparsedSegments.push(segment);
      previousExplicitCountableUnit = null;
    }
  }

  return operations.length || unparsedSegments.length
    ? { mealLabel, operations, unparsedSegments }
    : null;
}
