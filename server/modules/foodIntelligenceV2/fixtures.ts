/**
 * Fixtures sintéticas dos contratos V2 (§21.1).
 *
 * Não contêm dados reais, mídia, transcrição ou PII: apenas superfícies
 * sintéticas usadas pelos testes de contrato e pelos adapters. Fazem parte da
 * primeira entrega delimitada de §21.1 e não são consumidas por produção.
 */
import type {
  MealProcessingResult,
  MealSemanticContract,
} from "../../nutritionEngineTypes";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import type { FoodObservation, FoodResolutionDecision } from "./schemas";

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, overrides: unknown): T {
  return mergeValue(base, overrides) as T;
}

/**
 * Merge de fixtures por índice em arrays e por chave em objetos. Elementos
 * novos (sem base correspondente) são usados como vieram, então fixtures de
 * array precisam declarar suas próprias chaves obrigatórias.
 *
 * Array vazio no override substitui a coleção por vazio; array não vazio faz
 * merge por índice e preserva os itens extras da base.
 */
function mergeValue(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(override)) {
    if (override.length === 0) return [];
    const length = Math.max(base.length, override.length);
    return Array.from({ length }, (_, index) => {
      if (index >= override.length) return base[index];
      if (index >= base.length || base[index] === undefined) {
        return override[index];
      }
      return mergeValue(base[index], override[index]);
    });
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged: Plain = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;
      merged[key] = mergeValue(merged[key], value);
    }
    return merged;
  }
  return override === undefined ? base : override;
}

export function buildFoodAnchorFixture(overrides: unknown = {}) {
  return deepMerge(
    { sourceRef: "turn:1:text", span: { start: 0, end: 22 }, region: null },
    overrides
  );
}

export function buildFoodEvidenceFixture(overrides: unknown = {}) {
  return deepMerge(
    {
      evidenceId: "ev-1",
      field: "quantity.grams",
      origin: "catalog",
      value: 30,
      unit: "g",
      confidence: 0.8,
      verified: true,
      anchor: buildFoodAnchorFixture(),
      sourceId: null,
    },
    overrides
  );
}

export function buildFoodAlternativeFixture(overrides: unknown = {}) {
  return deepMerge(
    {
      candidateKey: "cand-1",
      foodEntityId: null,
      variantId: null,
      name: "Alternativa",
      brand: null,
      variant: null,
      preparation: [],
      qualifiers: [],
      evidenceIds: [],
      confidence: null,
    },
    overrides
  );
}

export function buildFoodObservationFixture(
  overrides: unknown = {}
): FoodObservation {
  const base: FoodObservation = {
    schemaVersion: 2,
    observationId: "obs-1",
    modality: "text",
    rawInput: "1,5 fatias de mortadela",
    normalizedInput: "1,5 fatias de mortadela",
    locale: { requested: null, effective: "pt-BR", status: "defaulted" },
    surfaceSpan: buildFoodAnchorFixture() as FoodObservation["surfaceSpan"],
    identityHints: {
      foodName: "mortadela",
      brand: null,
      variant: null,
      preparation: [],
      qualifiers: [],
      barcode: null,
    },
    quantityHints: {
      value: 1.5,
      unit: "fatia",
      servingText: "1,5 fatias",
      visiblePackageQuantity: null,
      visiblePackageUnit: null,
    },
    evidence: [
      {
        evidenceId: "ev-ident",
        field: "identity.foodName",
        origin: "text",
        value: "mortadela",
        unit: null,
        confidence: 0.9,
        verified: true,
        anchor: buildFoodAnchorFixture() as FoodObservation["surfaceSpan"],
        sourceId: null,
      },
      {
        evidenceId: "ev-qty",
        field: "quantity.value",
        origin: "text",
        value: 1.5,
        unit: "fatia",
        confidence: 0.9,
        verified: true,
        anchor: buildFoodAnchorFixture() as FoodObservation["surfaceSpan"],
        sourceId: null,
      },
    ],
    normalizationPath: [
      {
        stage: "S1",
        origin: "deterministic",
        lexiconEntryId: null,
        anchor: buildFoodAnchorFixture() as FoodObservation["surfaceSpan"],
        confidence: null,
      },
    ],
    alternatives: [],
    unresolvedReason: null,
    lexiconRevision: "lex-2026-10-05",
    interpreterVersion: null,
  };

  return deepMerge(base, overrides);
}

export function buildFoodResolutionDecisionFixture(
  overrides: unknown = {}
): FoodResolutionDecision {
  const base: FoodResolutionDecision = {
    schemaVersion: 2,
    decisionId: "dec-1",
    revision: 1,
    observationIds: ["obs-1"],
    traceId: "trace-1",
    status: "resolved",
    nextAction: "propose",
    identity: {
      candidateKey: "cand-mortadela",
      foodEntityId: 42,
      variantId: null,
      canonicalName: "Mortadela",
      brand: null,
      variant: null,
      preparation: [],
      qualifiers: [],
      barcode: null,
      confidence: 0.9,
      evidenceIds: ["ev-ident"],
    },
    quantity: {
      value: 1.5,
      unit: "fatia",
      grams: 30,
      milliliters: null,
      portionId: null,
      source: "household",
      measureKind: "usual_average",
      confidence: 0.8,
      evidenceIds: ["ev-grams"],
    },
    nutrition: {
      profileId: 7,
      sourceId: 3,
      verified: true,
      provisional: false,
      basis: {
        quantity: 100,
        unit: "g",
        values: {
          calories: 270,
          protein: 12,
          carbs: 3,
          fat: 23,
          fiber: null,
          sugar: null,
          sodiumMg: 900,
        },
      },
      consumed: {
        calories: 81,
        protein: 3.6,
        carbs: 0.9,
        fat: 6.9,
        fiber: null,
        sugar: null,
        sodiumMg: 270,
      },
      snapshotHash: "sha256:deadbeef",
      evidenceIds: ["ev-nutrition"],
    },
    classification: null,
    unresolvedFields: [],
    reasonCodes: [],
    alternatives: [],
    evidence: [
      {
        evidenceId: "ev-ident",
        field: "identity.foodName",
        origin: "text",
        value: "Mortadela",
        unit: null,
        confidence: 0.9,
        verified: true,
        anchor: buildFoodAnchorFixture() as FoodObservation["surfaceSpan"],
        sourceId: null,
      },
      {
        evidenceId: "ev-grams",
        field: "quantity.grams",
        origin: "catalog",
        value: 30,
        unit: "g",
        confidence: 0.8,
        verified: true,
        anchor: buildFoodAnchorFixture() as FoodObservation["surfaceSpan"],
        sourceId: 11,
      },
      {
        evidenceId: "ev-nutrition",
        field: "nutrition.calories",
        origin: "nutrition_label",
        value: 270,
        unit: "kcal",
        confidence: 0.95,
        verified: true,
        anchor: buildFoodAnchorFixture() as FoodObservation["surfaceSpan"],
        sourceId: 3,
      },
    ],
    knowledgeRevision: "kn-2026-10-05",
    policyVersion: "pol-2026-10-05",
  };

  return deepMerge(base, overrides);
}

export function buildMealOperationFixture(overrides: unknown = {}) {
  return deepMerge(
    { action: "add", targetMeal: "café da manhã", date: "2026-10-05" },
    overrides
  );
}

export function buildFoodOperationEnvelopeFixture(overrides: unknown = {}) {
  const base = {
    traceId: "trace-1",
    idempotencyKey: "op-1",
    ownerUserId: 7,
    conversationRef: "conv-1",
    turnRef: "turn-1",
    effectiveTimeZone: DEFAULT_APP_TIME_ZONE,
    mealOperation: buildMealOperationFixture(),
    contextSources: {
      previousMessage: {
        status: "available",
        reason: null,
        sourceRef: "turn:0",
      },
      preferences: {
        status: "absent",
        reason: "sem_preferencia_registrada",
        sourceRef: null,
      },
      recentHistory: {
        status: "absent",
        reason: "sem_historico_recente",
        sourceRef: null,
      },
    },
    revisions: {
      code: "sha:code",
      knowledge: "kn-2026-10-05",
      lexicon: "lex-2026-10-05",
      policy: "pol-2026-10-05",
      resolver: "v2.0.0",
    },
  };
  return deepMerge(base, overrides);
}

export function buildV1MealSemanticContractFixture(
  overrides: unknown = {}
): MealSemanticContract {
  const base: MealSemanticContract = {
    version: 1,
    originalText: "1,5 fatias de mortadela",
    normalizedText: "mortadela",
    inputType: "text",
    intent: "add_foods_to_meal",
    items: [],
    needsClarification: false,
    clarifications: [],
  };
  return deepMerge(base, overrides);
}

export function buildV1HistoricalSnapshotFixture(
  overrides: unknown = {}
): MealProcessingResult {
  const base: MealProcessingResult = {
    detectedMealLabel: "café da manhã",
    sourceText: "1,5 fatias de mortadela",
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "fixture sintética",
    items: [
      {
        foodName: "mortadela",
        canonicalName: "Mortadela",
        quantity: 1.5,
        unit: "fatia",
        portionText: "1,5 fatias",
        servings: 1.5,
        estimatedGrams: 30,
        calories: 81,
        protein: 3.6,
        carbs: 0.9,
        fat: 6.9,
        confidence: 0.9,
        source: "catalog",
      },
    ],
    totals: { calories: 81, protein: 3.6, carbs: 0.9, fat: 6.9 },
    semanticContract: buildV1MealSemanticContractFixture(),
  };
  return deepMerge(base, overrides);
}
