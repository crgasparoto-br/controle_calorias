import { extractCommercialVariant } from "./commercialProductIdentity";
import { normalizeForMatching } from "./mealTextParsing";
import type {
  CanonicalMealProcessingResult,
  MealDraftItem,
  MealProcessingInput,
  MealSemanticClarificationCode,
  MealSemanticContract,
  MealSemanticEvidenceOrigin,
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

function resolveInputEvidenceOrigin(input: MealProcessingInput): MealSemanticEvidenceOrigin {
  if (input.imageUrl) return "vision";
  if (input.transcript?.trim() || input.audioUrl) return "transcription";
  if (input.text?.trim()) return "text";
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
  inputOrigin: MealSemanticEvidenceOrigin,
): MealSemanticItem {
  const resolution = item.resolution;
  const nutritionOrigin = resolution?.nutritionOrigin
    ?? (item.source === "catalog" ? "catalog" : item.source === "hybrid" ? "ai_estimate" : "heuristic");
  const nutritionVerified = resolution?.nutritionVerified ?? item.source === "catalog";
  const identityOrigin = nutritionVerified && ["catalog", "web_research"].includes(nutritionOrigin)
    ? nutritionOrigin
    : inputOrigin;
  const productVariant = resolution?.productVariant
    ?? extractCommercialVariant(`${item.foodName} ${item.canonicalName}`);
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
        origin: item.brand ? identityOrigin : "unavailable",
        confidence: item.brand ? identityConfidence : 0.05,
        verified: Boolean(item.brand),
      },
      variant: {
        value: productVariant,
        origin: productVariant ? identityOrigin : "unavailable",
        confidence: productVariant ? identityConfidence : 0.05,
        verified: Boolean(productVariant),
      },
      quantity: {
        value: item.quantity,
        origin: inputOrigin,
        confidence: quantityConfidence,
        verified: item.quantity > 0,
      },
      estimatedGrams: {
        value: item.estimatedGrams,
        origin: nutritionOrigin === "catalog" || nutritionOrigin === "web_research"
          ? nutritionOrigin
          : inputOrigin,
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
  const inputOrigin = resolveInputEvidenceOrigin(input.processingInput);
  const items = input.items.map((item, itemIndex) =>
    buildSemanticItem(item, itemIndex, input.sourceText, inputOrigin)
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
