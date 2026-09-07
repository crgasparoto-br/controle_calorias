import { extractCommercialVariant } from "./commercialProductIdentity";
import {
  extractExplicitQuantities,
  normalizeForMatching,
  normalizeUnit,
} from "./mealTextParsing";
import type {
  CanonicalMealProcessingResult,
  MealDraftItem,
  MealProcessingInput,
  MealSemanticClarificationCode,
  MealSemanticContract,
  MealSemanticEvidenceOrigin,
  MealSemanticInputEvidenceField,
  MealSemanticInputType,
  MealSemanticItem,
} from "./nutritionEngineTypes";

function resolveInputType(input: MealProcessingInput): MealSemanticInputType {
  const hasImage = Boolean(input.imageUrl);
  const hasAudio = Boolean(input.audioUrl || input.transcript?.trim());
  const hasText = Boolean(input.text?.trim());
  if (hasImage && (hasAudio || hasText)) return "multimodal";
  if (hasImage) return "image";
  if (hasAudio) return "audio_transcript";
  return "text";
}

function hintedFieldOrigin(
  input: MealProcessingInput,
  field: MealSemanticInputEvidenceField,
) {
  return input.semanticEvidenceOrigins?.[field] ?? null;
}

function sourceContainsValue(source: string | undefined, value: string | null | undefined) {
  const normalizedValue = normalizeForMatching(value ?? "").trim();
  if (!source?.trim() || !normalizedValue) return false;

  const normalizedSource = normalizeForMatching(source);
  if (normalizedSource.includes(` ${normalizedValue} `)) return true;

  const meaningfulTokens = normalizedValue
    .split(/\s+/)
    .filter(token => token.length >= 3);
  return meaningfulTokens.length > 0
    && meaningfulTokens.every(token => normalizedSource.includes(` ${token} `));
}

function resolveIdentityFieldOrigin(input: {
  processingInput: MealProcessingInput;
  field: Extract<MealSemanticInputEvidenceField, "identity" | "brand" | "variant">;
  value: string | null;
  nutritionOrigin: MealSemanticEvidenceOrigin;
  nutritionVerified: boolean;
  preferOcrForImage: boolean;
}): MealSemanticEvidenceOrigin {
  const hint = hintedFieldOrigin(input.processingInput, input.field);
  if (hint) return hint;
  if (sourceContainsValue(input.processingInput.text, input.value)) return "text";
  if (sourceContainsValue(input.processingInput.transcript, input.value)) return "transcription";
  if (input.nutritionOrigin === "nutrition_label" && input.processingInput.imageUrl) return "ocr";
  if (
    input.nutritionVerified
    && (input.nutritionOrigin === "catalog" || input.nutritionOrigin === "web_research")
  ) {
    return input.nutritionOrigin;
  }
  if (input.processingInput.imageUrl) {
    return input.preferOcrForImage ? "ocr" : "vision";
  }
  if (input.processingInput.transcript?.trim() || input.processingInput.audioUrl) return "transcription";
  if (input.processingInput.text?.trim()) return "text";
  return "unavailable";
}

function quantitiesMatchSource(source: string | undefined, item: MealDraftItem) {
  if (!source?.trim()) return false;
  const itemUnit = normalizeUnit(item.unit);
  return extractExplicitQuantities(source).some(candidate =>
    Math.abs(candidate.quantity - item.quantity) <= 0.0001
    && normalizeUnit(candidate.unit) === itemUnit
  );
}

function resolveQuantityOrigin(
  processingInput: MealProcessingInput,
  item: MealDraftItem,
): MealSemanticEvidenceOrigin {
  const hint = hintedFieldOrigin(processingInput, "quantity");
  if (hint) return hint;
  if (quantitiesMatchSource(processingInput.text, item)) return "text";
  if (quantitiesMatchSource(processingInput.transcript, item)) return "transcription";
  if (processingInput.imageUrl) return "vision";
  if (processingInput.transcript?.trim() || processingInput.audioUrl) return "transcription";
  if (processingInput.text?.trim()) return "text";
  return "unavailable";
}

function sourceContainsEstimatedGrams(source: string | undefined, estimatedGrams: number) {
  if (!source?.trim() || estimatedGrams <= 0) return false;
  return extractExplicitQuantities(source).some(candidate =>
    candidate.estimatedGrams != null
    && Math.abs(candidate.estimatedGrams - estimatedGrams) <= 0.05
  );
}

function resolveEstimatedGramsOrigin(input: {
  processingInput: MealProcessingInput;
  item: MealDraftItem;
  nutritionOrigin: MealSemanticEvidenceOrigin;
}): MealSemanticEvidenceOrigin {
  const hint = hintedFieldOrigin(input.processingInput, "estimatedGrams");
  if (hint) return hint;
  if (sourceContainsEstimatedGrams(input.processingInput.text, input.item.estimatedGrams)) return "text";
  if (sourceContainsEstimatedGrams(input.processingInput.transcript, input.item.estimatedGrams)) return "transcription";
  if (
    input.nutritionOrigin === "catalog"
    || input.nutritionOrigin === "web_research"
    || input.nutritionOrigin === "nutrition_label"
    || input.nutritionOrigin === "ai_estimate"
    || input.nutritionOrigin === "heuristic"
  ) {
    return input.nutritionOrigin;
  }
  if (input.processingInput.imageUrl) return "vision";
  if (input.processingInput.transcript?.trim() || input.processingInput.audioUrl) return "transcription";
  if (input.processingInput.text?.trim()) return "text";
  return "unavailable";
}

function clampEvidenceConfidence(value: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0.5, 0.05), 0.99);
}

function clarificationMessage(
  item: MealDraftItem,
  code: MealSemanticClarificationCode,
) {
  const identity = item.brand
    ? `${item.foodName} (${item.brand})`
    : item.foodName;
  if (code === "brand_variant_unresolved") {
    const alternatives = item.resolution?.ambiguity?.alternatives ?? [];
    if (alternatives.length > 1) {
      return `Encontrei mais de uma variante possível para ${identity}. Informe qual variante você consumiu: ${alternatives.map(candidate => candidate.name).join(", ")}.`;
    }
    return `Não consegui determinar a variante exata de ${identity}. Informe a variante/linha/sabor ou envie uma foto legível do rótulo antes de registrar os nutrientes.`;
  }
  return `Não consegui comprovar a identidade comercial exata de ${identity}. Confirme a variante ou envie um rótulo legível antes de registrar os nutrientes.`;
}

function buildSemanticItem(
  item: MealDraftItem,
  itemIndex: number,
  originalText: string,
  processingInput: MealProcessingInput,
): MealSemanticItem {
  const resolution = item.resolution;
  const nutritionOrigin = resolution?.nutritionOrigin
    ?? (item.source === "catalog" ? "catalog" : item.source === "hybrid" ? "ai_estimate" : "heuristic");
  const nutritionVerified = resolution?.nutritionVerified ?? item.source === "catalog";
  const productVariant = resolution?.productVariant
    ?? extractCommercialVariant(`${item.foodName} ${item.canonicalName}`);
  const identityOrigin = resolveIdentityFieldOrigin({
    processingInput,
    field: "identity",
    value: item.foodName,
    nutritionOrigin,
    nutritionVerified,
    preferOcrForImage: Boolean(item.brand || productVariant),
  });
  const brandOrigin = item.brand
    ? resolveIdentityFieldOrigin({
        processingInput,
        field: "brand",
        value: item.brand,
        nutritionOrigin,
        nutritionVerified,
        preferOcrForImage: true,
      })
    : "unavailable";
  const variantOrigin = productVariant
    ? resolveIdentityFieldOrigin({
        processingInput,
        field: "variant",
        value: productVariant,
        nutritionOrigin,
        nutritionVerified,
        preferOcrForImage: true,
      })
    : "unavailable";
  const quantityOrigin = resolveQuantityOrigin(processingInput, item);
  const estimatedGramsOrigin = resolveEstimatedGramsOrigin({
    processingInput,
    item,
    nutritionOrigin,
  });
  const ambiguity = resolution?.ambiguity ?? null;
  const identityConfidence = clampEvidenceConfidence(item.confidence);
  const sourceConfidence = clampEvidenceConfidence(
    resolution?.sourceConfidence
      ?? (nutritionVerified ? Math.max(item.confidence, 0.8) : Math.min(item.confidence, 0.6)),
  );
  const quantityConfidence = clampEvidenceConfidence(
    item.quantity > 0 && item.unit.trim() ? Math.max(item.confidence, 0.8) : Math.min(item.confidence, 0.5),
  );
  const normalizedText = normalizeForMatching(item.foodName).trim();
  const code = ambiguity?.reason ?? null;

  return {
    itemIndex,
    originalText,
    normalizedText,
    commercialName: item.foodName,
    category: item.classification?.processingLevel ?? null,
    brand: item.brand?.trim() || null,
    productVariant,
    barcode: null,
    quantity: item.quantity,
    unit: item.unit,
    portionText: item.portionText,
    estimatedGrams: item.estimatedGrams,
    confidence: {
      identity: identityConfidence,
      quantity: quantityConfidence,
      source: sourceConfidence,
    },
    evidence: {
      identity: {
        value: item.foodName,
        origin: identityOrigin,
        confidence: identityConfidence,
        verified: identityOrigin !== "unavailable",
      },
      brand: {
        value: item.brand?.trim() || null,
        origin: brandOrigin,
        confidence: item.brand ? identityConfidence : 0.05,
        verified: Boolean(item.brand),
      },
      variant: {
        value: productVariant,
        origin: variantOrigin,
        confidence: productVariant ? identityConfidence : 0.05,
        verified: Boolean(productVariant),
      },
      quantity: {
        value: item.quantity,
        origin: quantityOrigin,
        confidence: quantityConfidence,
        verified: item.quantity > 0,
      },
      estimatedGrams: {
        value: item.estimatedGrams,
        origin: estimatedGramsOrigin,
        confidence: quantityConfidence,
        verified: item.estimatedGrams > 0,
      },
      nutrition: {
        value: {
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          sourceUrls: [...(resolution?.sourceUrls ?? [])],
          sourceEvidence: resolution?.sourceEvidence?.trim() || null,
          sourceVerifiedAt: resolution?.sourceVerifiedAt?.toISOString() ?? null,
        },
        origin: nutritionOrigin,
        confidence: sourceConfidence,
        verified: nutritionVerified,
      },
    },
    alternatives: [...(ambiguity?.alternatives ?? [])],
    needsClarification: Boolean(code),
    clarificationReason: code
      ? { code, message: clarificationMessage(item, code) }
      : null,
  };
}

export function buildMealSemanticContract(input: {
  processingInput: MealProcessingInput;
  sourceText: string;
  items: MealDraftItem[];
}): MealSemanticContract {
  const items = input.items.map((item, itemIndex) =>
    buildSemanticItem(item, itemIndex, input.sourceText, input.processingInput)
  );
  const clarifications = items
    .filter((item): item is MealSemanticItem & { clarificationReason: NonNullable<MealSemanticItem["clarificationReason"]> } => Boolean(item.clarificationReason))
    .map(item => ({
      itemIndex: item.itemIndex,
      code: item.clarificationReason.code,
      message: item.clarificationReason.message,
      alternatives: [...item.alternatives],
    }));

  return {
    version: 1,
    originalText: input.sourceText,
    normalizedText: normalizeForMatching(input.sourceText).trim(),
    inputType: resolveInputType(input.processingInput),
    intent: input.processingInput.intentHint?.intent ?? "add_foods_to_meal",
    items,
    needsClarification: clarifications.length > 0,
    clarifications,
  };
}

export function withSemanticContract(
  result: Omit<CanonicalMealProcessingResult, "semanticContract">,
  processingInput: MealProcessingInput,
): CanonicalMealProcessingResult {
  return {
    ...result,
    semanticContract: buildMealSemanticContract({
      processingInput,
      sourceText: result.sourceText,
      items: result.items,
    }),
  };
}
