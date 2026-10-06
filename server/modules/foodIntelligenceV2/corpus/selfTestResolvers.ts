/**
 * Implementações de teste do resolvedor sob teste, usadas **somente** para
 * validar o próprio harness (issue #1299, "Testar o próprio harness").
 *
 * Elas não substituem o resolvedor em medição real: o harness entrega o caso
 * a `resolve()` e projeta a decisão devolvida. Aqui, os duplos deliberadamente
 * corretos ou errados permitem provar que o harness reprova o que deve
 * reprovar (§4.1.8, §18).
 */
import {
  type CorpusResolverResult,
  type CorpusResolverUnderTest,
  type ExpectedDecision,
  type GoldenCorpus,
  type GoldenCorpusCase,
} from "./contracts";
import type {
  FoodEvidenceOrigin,
  FoodReasonCode,
  FoodField,
} from "../contracts";
import { isGroundedEvidenceOrigin } from "../contracts";
import type {
  FoodResolutionDecision,
  FoodNutritionValues,
  MealOperation,
} from "../schemas";
import { FOOD_RESOLUTION_DECISION_SCHEMA_VERSION } from "../contracts";

const PREFERRED_ORIGINS: readonly FoodEvidenceOrigin[] = [
  "nutrition_label",
  "barcode",
  "catalog",
  "vision",
  "ocr",
  "memory",
  "web_research",
  "text",
  "transcription",
  "provisional_estimate",
  "ai_estimate",
  "heuristic",
];

/** Escolhe uma origem de nutrição aceitável para o caso. */
export function pickNutritionOrigin(
  expected: ExpectedDecision
): FoodEvidenceOrigin {
  const { allowedOrigins, forbiddenOrigins } = expected.nutrition;
  const allowed =
    allowedOrigins.length > 0
      ? PREFERRED_ORIGINS.filter(origin => allowedOrigins.includes(origin))
      : PREFERRED_ORIGINS;
  const candidate = allowed.find(origin => !forbiddenOrigins.includes(origin));
  if (candidate) return candidate;
  const fallback = PREFERRED_ORIGINS.find(
    origin => !forbiddenOrigins.includes(origin)
  );
  return fallback ?? "provisional_estimate";
}

const BASE_VALUES: FoodNutritionValues = {
  calories: 120,
  protein: 5,
  carbs: 12,
  fat: 4,
  fiber: 1,
  sugar: 2,
  sodiumMg: 80,
};

function anchor(sourceRef: string) {
  return { sourceRef, span: { start: 0, end: 1 }, region: null };
}

/** Constrói a decisão que corresponde à expectativa declarada (§5). */
export function buildDecisionForExpected(
  entry: GoldenCorpusCase,
  expected: ExpectedDecision,
  index: number
): FoodResolutionDecision {
  const suffix = `${entry.caseId}-${index}`;
  const evidence: FoodResolutionDecision["evidence"] = [];

  const identityAsserted = expected.identity.asserted;
  const identityEvidenceId = `ev-id-${suffix}`;
  if (identityAsserted) {
    evidence.push({
      evidenceId: identityEvidenceId,
      field: "identity.foodName",
      origin: "text",
      value: expected.identity.canonicalName ?? "observado",
      unit: null,
      confidence: 0.9,
      verified: true,
      anchor: anchor(`turn:${suffix}`),
      sourceId: null,
    });
  }

  const quantityValue = expected.quantity.value;
  // `status=resolved` exige quantidade utilizável (§5). Quando o caso não
  // declara quantidade (ex.: item sem porção observada), o oráculo precisa
  // ainda assim produzir uma quantidade utilizável para a decisão ser válida;
  // a comparação continua ignorando o campo, porque `asserted=false`.
  const resolvedFallbackQuantity =
    expected.status === "resolved" &&
    quantityValue === null &&
    expected.quantity.grams === null &&
    expected.quantity.milliliters === null;
  const effectiveQuantityValue = resolvedFallbackQuantity ? 1 : quantityValue;
  const effectiveQuantityUnit =
    expected.quantity.unit ?? (resolvedFallbackQuantity ? "porção" : null);
  const quantityEvidenceId = `ev-qty-${suffix}`;
  if (effectiveQuantityValue !== null) {
    evidence.push({
      evidenceId: quantityEvidenceId,
      field: "quantity.value",
      origin: "text",
      value: effectiveQuantityValue,
      unit: effectiveQuantityUnit,
      confidence: 0.9,
      verified: true,
      anchor: anchor(`turn:${suffix}`),
      sourceId: null,
    });
  }

  const nutritionOrigin = pickNutritionOrigin(expected);
  const provisional =
    expected.nutrition.provisionalRequired ||
    expected.nutrition.requirement === "provisional_declared";
  const nutritionNeeded =
    expected.status === "resolved" ||
    expected.nutrition.requirement !== "not_asserted";
  const nutritionEvidenceId = `ev-nut-${suffix}`;
  if (nutritionNeeded) {
    evidence.push({
      evidenceId: nutritionEvidenceId,
      field: "nutrition.calories",
      origin: nutritionOrigin,
      value: BASE_VALUES.calories,
      unit: "kcal",
      confidence: provisional ? null : 0.9,
      verified: provisional ? false : isGroundedEvidenceOrigin(nutritionOrigin),
      anchor: anchor(`turn:${suffix}`),
      sourceId: null,
    });
  }

  const alternatives: FoodResolutionDecision["alternatives"] = [];
  if (expected.ambiguity.mustPreserveAlternatives) {
    const count = Math.max(2, expected.ambiguity.minAlternatives);
    for (let i = 0; i < count; i += 1) {
      const alternativeEvidenceId = `ev-alt-${suffix}-${i}`;
      evidence.push({
        evidenceId: alternativeEvidenceId,
        field: "identity.foodName",
        origin: "text",
        value: `alternativa-${i + 1}`,
        unit: null,
        confidence: 0.5,
        verified: true,
        anchor: anchor(`turn:${suffix}`),
        sourceId: null,
      });
      alternatives.push({
        candidateKey: `alt-${suffix}-${i}`,
        foodEntityId: 9000 + i,
        variantId: null,
        name: `alternativa-${i + 1}`,
        brand: null,
        variant: null,
        preparation: [],
        qualifiers: [],
        evidenceIds: [alternativeEvidenceId],
        confidence: 0.5,
      });
    }
  }

  const identitySustained =
    identityAsserted && expected.identity.canonicalName !== null;

  return {
    schemaVersion: FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
    decisionId: `dec-${suffix}`,
    revision: 1,
    observationIds: [`obs-${suffix}`],
    traceId: `trace-${suffix}`,
    status: expected.status,
    nextAction: expected.nextAction,
    identity: {
      candidateKey: identitySustained ? `cand-${suffix}` : null,
      foodEntityId: identitySustained ? 1000 + index : null,
      variantId: null,
      canonicalName: identityAsserted ? expected.identity.canonicalName : null,
      brand: identityAsserted ? expected.identity.brand : null,
      variant: identityAsserted ? expected.identity.variant : null,
      preparation: identityAsserted ? [...expected.identity.preparation] : [],
      qualifiers: identityAsserted
        ? expected.identity.qualifiers.map(value => ({
            value,
            attributeCode: null,
            role: null,
            confidence: null,
          }))
        : [],
      barcode: identityAsserted ? expected.identity.barcode : null,
      confidence: 0.9,
      evidenceIds: identityAsserted ? [identityEvidenceId] : [],
    },
    quantity: {
      value: effectiveQuantityValue,
      unit: effectiveQuantityUnit,
      grams: expected.quantity.grams,
      milliliters: expected.quantity.milliliters,
      portionId: null,
      source: null,
      measureKind: expected.quantity.measureKind,
      confidence: effectiveQuantityValue === null ? null : 0.9,
      evidenceIds: effectiveQuantityValue === null ? [] : [quantityEvidenceId],
    },
    nutrition: nutritionNeeded
      ? {
          profileId: 10,
          sourceId: 20,
          verified: provisional ? false : true,
          provisional,
          basis: { quantity: 100, unit: "g", values: BASE_VALUES },
          consumed: BASE_VALUES,
          snapshotHash: `sha256:${suffix}`,
          evidenceIds: [nutritionEvidenceId],
        }
      : {
          profileId: null,
          sourceId: null,
          verified: false,
          provisional: false,
          basis: null,
          consumed: null,
          snapshotHash: null,
          evidenceIds: [],
        },
    classification: null,
    unresolvedFields: [...expected.unresolvedFields] as FoodField[],
    reasonCodes: [...expected.reasonCodes] as FoodReasonCode[],
    alternatives,
    evidence,
    knowledgeRevision: "kn-2026-10-06",
    policyVersion: "pol-2026-10-06",
  };
}

function operationFor(entry: GoldenCorpusCase): MealOperation | null {
  const expected = entry.expected.operation;
  if (!expected) return null;
  return {
    action: expected.action,
    targetMeal: expected.targetMeal,
    date: expected.date,
  };
}

function resultFor(
  entry: GoldenCorpusCase,
  caseEntry: GoldenCorpusCase = entry
): CorpusResolverResult {
  const decisions = caseEntry.expected.decisions.map((expected, index) =>
    buildDecisionForExpected(caseEntry, expected, index)
  );
  return { decisions, operation: operationFor(caseEntry) };
}

/**
 * Resolvedor de referência: produz exatamente o resultado esperado do corpus.
 * Serve como oráculo do harness, não como resolvedor de produção.
 */
export function createReferenceResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const byCaseId = new Map(corpus.cases.map(entry => [entry.caseId, entry]));
  return {
    id: "self-test:reference-oracle",
    revision: "self-test-1",
    resolve({ case: entry }) {
      const source = byCaseId.get(entry.caseId) ?? entry;
      return resultFor(entry, source);
    },
  };
}

/** Resolvedor que erra por deslocamento: devolve o resultado do caso seguinte. */
export function createShiftedResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  return {
    id: "self-test:shifted-wrong",
    revision: "self-test-1",
    resolve({ case: entry }) {
      const index = corpus.cases.findIndex(
        item => item.caseId === entry.caseId
      );
      const next = corpus.cases[(index + 1) % corpus.cases.length];
      return resultFor(entry, next);
    },
  };
}

/**
 * Resolvedor que faz um grupo metamórfico convergir para o **mesmo resultado
 * errado**. Deve reprovar: convergência entre saídas não substitui a
 * referência independente (§4.1.8).
 */
export function createWrongConvergenceResolver(
  corpus: GoldenCorpus,
  groupId: string
): CorpusResolverUnderTest {
  const members = new Set(
    corpus.cases
      .filter(entry => entry.metamorphicGroup === groupId)
      .map(entry => entry.caseId)
  );
  return {
    id: `self-test:wrong-convergence:${groupId}`,
    revision: "self-test-1",
    resolve({ case: entry }) {
      const result = resultFor(entry);
      if (!members.has(entry.caseId)) return result;
      return {
        ...result,
        decisions: result.decisions.map(decision => ({
          ...decision,
          identity: {
            ...decision.identity,
            canonicalName: "alimento-errado",
            brand: null,
            variant: null,
          },
        })),
      };
    },
  };
}

/** Resolvedor que sempre pede clarificação: abstenção sistemática. */
export function createAlwaysClarifyResolver(): CorpusResolverUnderTest {
  return {
    id: "self-test:always-clarify",
    revision: "self-test-1",
    resolve({ case: entry }) {
      return {
        decisions: [
          buildDecisionForExpected(
            entry,
            {
              label: "abstencao",
              status: "ambiguous",
              nextAction: "clarify",
              identity: {
                asserted: false,
                canonicalName: null,
                brand: null,
                variant: null,
                preparation: [],
                qualifiers: [],
                barcode: null,
              },
              quantity: {
                asserted: false,
                value: null,
                unit: null,
                grams: null,
                milliliters: null,
                measureKind: null,
                unitMustNotBeConvertedToGrams: false,
              },
              nutrition: {
                requirement: "not_asserted",
                allowedOrigins: [],
                forbiddenOrigins: [],
                provisionalRequired: false,
                genericProfileMustNotBeVerified: false,
              },
              ambiguity: {
                mustPreserveAlternatives: true,
                minAlternatives: 2,
              },
              clarification: { requiredFields: ["identity"] },
              unresolvedFields: ["identity"],
              reasonCodes: ["unknown_surface"],
              forbiddenReasonCodes: [],
            },
            0
          ),
        ],
        operation: null,
      };
    },
  };
}

/** Resolvedor que não devolve decisão alguma. */
export function createEmptyResolver(): CorpusResolverUnderTest {
  return {
    id: "self-test:empty",
    revision: "self-test-1",
    resolve() {
      return { decisions: [] };
    },
  };
}

/** Resolvedor que falha em toda execução. */
export function createThrowingResolver(): CorpusResolverUnderTest {
  return {
    id: "self-test:throwing",
    revision: "self-test-1",
    resolve() {
      throw new Error("provider indisponível no duplo de teste");
    },
  };
}

/**
 * Resolvedor que devolve decisão válida, porém com `schemaVersion` não
 * governado: versão diferente não pode ser interpretada silenciosamente.
 */
export function createVersionMismatchResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const reference = createReferenceResolver(corpus);
  return {
    id: "self-test:version-mismatch",
    revision: "self-test-1",
    async resolve(request) {
      const result = await reference.resolve(request);
      return {
        ...result,
        decisions: result.decisions.map(decision => ({
          ...decision,
          schemaVersion: 99 as unknown as typeof decision.schemaVersion,
        })),
      };
    },
  };
}

/**
 * Resolvedor que grava conhecimento em casos reservados. Deve bloquear a
 * medição: holdout não alimenta aliases/prompts/promoção (§16.1).
 */
export function createHoldoutWritingResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const reference = createReferenceResolver(corpus);
  return {
    id: "self-test:holdout-writer",
    revision: "self-test-1",
    async resolve(request) {
      const result = await reference.resolve(request);
      if (request.case.split === "holdout") {
        return {
          ...result,
          knowledgeWrites: [`alias:${request.case.caseId}`],
        };
      }
      return result;
    },
  };
}

/** Executa uma lista de casos com o oráculo. Usado pelos testes do harness. */
export async function runWithReference(
  corpus: GoldenCorpus
): Promise<CorpusResolverUnderTest> {
  return createReferenceResolver(corpus);
}
