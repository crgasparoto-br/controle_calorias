/**
 * Implementações de teste do resolvedor sob teste, usadas **somente** para
 * validar o próprio harness (issue #1299, "Testar o próprio harness").
 *
 * Elas não substituem o resolvedor em medição real: o harness entrega o caso a
 * `resolve()` e projeta a decisão devolvida. Aqui, os duplos deliberadamente
 * corretos ou errados permitem provar que o harness reprova o que deve
 * reprovar (§4.1.8, §16.1, §18).
 */
import {
  type CorpusResolverResult,
  type CorpusResolverUnderTest,
  type ExpectedDecision,
  type GoldenCorpus,
  type GoldenCorpusCase,
} from "./contracts";
import {
  FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
  isGroundedEvidenceOrigin,
} from "../contracts";
import type {
  FoodEvidenceOrigin,
  FoodField,
  FoodReasonCode,
} from "../contracts";
import type {
  FoodNutritionValues,
  FoodResolutionDecision,
  MealOperation,
} from "../schemas";

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

const BASE_VALUES: FoodNutritionValues = {
  calories: 120,
  protein: 5,
  carbs: 12,
  fat: 4,
  fiber: 1,
  sugar: 2,
  sodiumMg: 80,
};

const ALIAS_KEY = "alias:cafe-da-firma";
const ALIAS_VALUE = "cafe|sem-acucar";

function anchor(sourceRef: string) {
  return { sourceRef, span: { start: 0, end: 1 }, region: null };
}

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

/** Constrói a decisão que corresponde à expectativa declarada (§5). */
export function buildDecisionForExpected(
  entry: GoldenCorpusCase,
  expected: ExpectedDecision,
  index: number,
  overrides: { nutritionOrigin?: FoodEvidenceOrigin } = {}
): FoodResolutionDecision {
  const suffix = `${entry.caseId}-${index}`;
  const evidence: FoodResolutionDecision["evidence"] = [];

  const identityExpected = expected.identity.presence === "expected";
  const identityEvidenceId = `ev-id-${suffix}`;
  if (identityExpected) {
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

  // `status=resolved` exige quantidade utilizável (§5). Quando o caso não
  // afirma quantidade (`unspecified`), o duplo ainda precisa produzir uma
  // quantidade utilizável para a decisão ser válida; a comparação continua
  // ignorando o campo, porque a presença declarada é `unspecified`.
  const quantityExpected = expected.quantity.presence === "expected";
  const needsUsableQuantity =
    expected.status === "resolved" &&
    (quantityExpected || expected.quantity.presence === "unspecified");
  const effectiveQuantityValue = quantityExpected
    ? expected.quantity.value
    : needsUsableQuantity
      ? 1
      : null;
  const effectiveQuantityUnit = quantityExpected
    ? expected.quantity.unit
    : needsUsableQuantity
      ? "porção"
      : null;

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

  const nutritionOrigin =
    overrides.nutritionOrigin ?? pickNutritionOrigin(expected);
  const provisional =
    expected.nutrition.provisionalRequired ||
    expected.nutrition.requirement === "provisional_declared";
  const nutritionNeeded =
    expected.nutrition.requirement === "provenance_declared" ||
    expected.nutrition.requirement === "provisional_declared";
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
  expected.alternatives.forEach((alternative, alternativeIndex) => {
    const alternativeEvidenceId = `ev-alt-${suffix}-${alternativeIndex}`;
    evidence.push({
      evidenceId: alternativeEvidenceId,
      field: "identity.foodName",
      origin: "text",
      value: alternative.name,
      unit: null,
      confidence: 0.5,
      verified: true,
      anchor: anchor(`turn:${suffix}`),
      sourceId: null,
    });
    alternatives.push({
      candidateKey: `alt-${suffix}-${alternativeIndex}`,
      foodEntityId: 9000 + alternativeIndex,
      variantId: null,
      name: alternative.name,
      brand: alternative.brand,
      variant: alternative.variant,
      preparation: [...alternative.preparation],
      qualifiers: alternative.qualifiers.map(value => ({
        value,
        attributeCode: null,
        role: null,
        confidence: null,
      })),
      evidenceIds: [alternativeEvidenceId],
      confidence: 0.5,
    });
  });

  return {
    schemaVersion: FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
    decisionId: `dec-${suffix}`,
    revision: 1,
    observationIds: [`obs-${suffix}`],
    traceId: `trace-${suffix}`,
    status: expected.status,
    nextAction: expected.nextAction,
    identity: {
      candidateKey: identityExpected ? `cand-${suffix}` : null,
      foodEntityId: identityExpected ? 1000 + index : null,
      variantId: null,
      canonicalName: identityExpected ? expected.identity.canonicalName : null,
      brand: identityExpected ? expected.identity.brand : null,
      variant: identityExpected ? expected.identity.variant : null,
      preparation: identityExpected ? [...expected.identity.preparation] : [],
      qualifiers: identityExpected
        ? expected.identity.qualifiers.map(value => ({
            value,
            attributeCode: null,
            role: null,
            confidence: null,
          }))
        : [],
      barcode: identityExpected ? expected.identity.barcode : null,
      confidence: 0.9,
      evidenceIds: identityExpected ? [identityEvidenceId] : [],
    },
    quantity: {
      value: effectiveQuantityValue,
      unit: effectiveQuantityUnit,
      grams: quantityExpected ? expected.quantity.grams : null,
      milliliters: quantityExpected ? expected.quantity.milliliters : null,
      portionId: null,
      source: null,
      measureKind: quantityExpected ? expected.quantity.measureKind : null,
      confidence: effectiveQuantityValue === null ? null : 0.9,
      evidenceIds: effectiveQuantityValue === null ? [] : [quantityEvidenceId],
    },
    nutrition: nutritionNeeded
      ? {
          profileId: 10,
          sourceId: 20,
          verified: !provisional,
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
    // Classificação (§8.7, §9.3 classe J): o duplo de referência devolve
    // classificação **presente e versionada** em item proposto. Quando o caso
    // mede classificação, devolve exatamente o conteúdo declarado; quando não
    // mede, devolve o conteúdo estrutural mínimo, sem afirmar o que o caso não
    // afirma.
    classification:
      expected.nextAction === "propose"
        ? {
            version: "class-2026-10-06",
            processingLevel: expected.classification.measured
              ? expected.classification.processingLevel
              : null,
            isFruit: expected.classification.measured
              ? expected.classification.isFruit
              : null,
            isVegetable: expected.classification.measured
              ? expected.classification.isVegetable
              : null,
            isUltraProcessed: expected.classification.measured
              ? expected.classification.isUltraProcessed
              : null,
            confidence: 0.9,
            provisional: expected.classification.provisionalRequired,
            evidenceIds: [],
          }
        : null,
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

function corpusIndex(corpus: GoldenCorpus) {
  return new Map(corpus.cases.map(entry => [entry.caseId, entry]));
}

/**
 * Resolvedor de referência: produz exatamente o resultado esperado do corpus.
 * Serve como oráculo do harness, não como resolvedor de produção.
 */
export function createReferenceResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const byCaseId = corpusIndex(corpus);
  return {
    id: "self-test:reference-oracle",
    revision: "self-test-2",
    async resolve({ case: entry, allowLearning, knowledge }) {
      const source = byCaseId.get(entry.caseId);
      if (!source) throw new Error(`caso desconhecido: ${entry.caseId}`);
      // §16.1 exige efeito observável: a fase de aquisição registra a chave e
      // os passos posteriores a **consultam**. Um resolvedor que devolve o
      // resultado por caseId sem consultar a fachada não prova aprendizado e
      // reprova na cadeia causal do harness.
      if (allowLearning && knowledge.mode === "acquisition") {
        await knowledge.write(
          `${entry.scenario.ownerRef}:${ALIAS_KEY}`,
          ALIAS_VALUE
        );
      } else if (knowledge.mode === "read_only") {
        await knowledge.read(`${entry.scenario.ownerRef}:${ALIAS_KEY}`);
      }
      return resultFor(source);
    },
  };
}

/**
 * Resolvedor **stateful** de aprendizado: grava o alias na fachada durante a
 * aquisição, lê a fachada nas fases seguintes, respeita o escopo de proprietário
 * e deixa de aplicar o alias quando a chave é revogada. É o duplo que prova que
 * o protocolo de §16.1 é realmente exercitado (persistência, isolamento,
 * precedência e revogação).
 */
export function createLearningResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const byCaseId = corpusIndex(corpus);
  const acquiredCaseId = "c-aprendizado-alias-definido";

  return {
    id: "self-test:learning-resolver",
    revision: "self-test-2",
    async resolve({ case: entry, allowLearning, knowledge }) {
      const source = byCaseId.get(entry.caseId);
      if (!source) throw new Error(`caso desconhecido: ${entry.caseId}`);
      const ownerRef = entry.scenario.ownerRef;
      const key = `${ownerRef}:${ALIAS_KEY}`;

      if (allowLearning && knowledge.mode === "acquisition") {
        await knowledge.write(key, ALIAS_VALUE);
        return resultFor(source);
      }

      const learned = await knowledge.read(key);
      const acquired = byCaseId.get(acquiredCaseId);
      const appliesToSurface =
        entry.input.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "") ===
        "cafe da firma";
      if (learned !== null && appliesToSurface && acquired) {
        return resultFor(source, acquired);
      }
      return resultFor(source);
    },
  };
}

/**
 * Resolvedor que mantém cache próprio e **ignora a revogação**: depois de
 * revogada a chave, continua aplicando o alias aprendido. Deve reprovar o
 * cenário de §16.1 (`differentFromStepId` não satisfeito), provando que a
 * revogação é verificada e não apenas declarada.
 */
export function createCacheIgnoringRevocationResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const byCaseId = corpusIndex(corpus);
  const acquiredCaseId = "c-aprendizado-alias-definido";
  const cache = new Map<string, string>();

  return {
    id: "self-test:cache-ignoring-revocation",
    revision: "self-test-2",
    async resolve({ case: entry, allowLearning, knowledge }) {
      const source = byCaseId.get(entry.caseId);
      if (!source) throw new Error(`caso desconhecido: ${entry.caseId}`);
      const key = `${entry.scenario.ownerRef}:${ALIAS_KEY}`;

      if (allowLearning && knowledge.mode === "acquisition") {
        await knowledge.write(key, ALIAS_VALUE);
        cache.set(key, ALIAS_VALUE);
        return resultFor(source);
      }

      const acquired = byCaseId.get(acquiredCaseId);
      const appliesToSurface =
        entry.input.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "") ===
        "cafe da firma";
      // Cache obsoleto: nunca consulta a fachada depois da aquisição.
      if (cache.has(key) && appliesToSurface && acquired) {
        return resultFor(source, acquired);
      }
      return resultFor(source);
    },
  };
}

/** Resolvedor que erra por deslocamento: devolve o resultado do caso seguinte. */
export function createShiftedResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  return {
    id: "self-test:shifted-wrong",
    revision: "self-test-2",
    resolve({ case: entry }) {
      const index = corpus.cases.findIndex(
        item => item.caseId === entry.caseId
      );
      if (index === -1) throw new Error(`caso desconhecido: ${entry.caseId}`);
      const next = corpus.cases[(index + 1) % corpus.cases.length];
      return resultFor(corpus.cases[index], next);
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
    revision: "self-test-2",
    resolve({ case: entry }) {
      const source = corpus.cases.find(item => item.caseId === entry.caseId);
      if (!source) throw new Error(`caso desconhecido: ${entry.caseId}`);
      const result = resultFor(source);
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

function syntheticAmbiguousExpectation(): ExpectedDecision {
  return {
    label: "abstencao",
    status: "ambiguous",
    nextAction: "clarify",
    identity: {
      presence: "forbidden",
      canonicalName: null,
      brand: null,
      variant: null,
      preparation: [],
      qualifiers: [],
      barcode: null,
    },
    classification: {
      measured: false,
      processingLevel: null,
      isFruit: null,
      isVegetable: null,
      isUltraProcessed: null,
      provisionalRequired: false,
    },
    quantity: {
      presence: "forbidden",
      value: null,
      unit: null,
      grams: null,
      milliliters: null,
      measureKind: null,
      unitMustNotBeConvertedToGrams: false,
    },
    nutrition: {
      requirement: "absent",
      allowedOrigins: [],
      forbiddenOrigins: [],
      provisionalRequired: false,
      genericProfileMustNotBeVerified: false,
    },
    ambiguity: { mustPreserveAlternatives: true, minAlternatives: 2 },
    alternatives: [
      {
        name: "alternativa-1",
        brand: null,
        variant: null,
        preparation: [],
        qualifiers: [],
      },
      {
        name: "alternativa-2",
        brand: null,
        variant: null,
        preparation: [],
        qualifiers: [],
      },
    ],
    clarification: { requiredFields: ["identity"] },
    unresolvedFields: ["identity"],
    reasonCodes: ["unknown_surface"],
    forbiddenReasonCodes: [],
  };
}

/** Resolvedor que sempre pede clarificação: abstenção sistemática. */
export function createAlwaysClarifyResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const byCaseId = corpusIndex(corpus);
  return {
    id: "self-test:always-clarify",
    revision: "self-test-2",
    resolve({ case: entry }) {
      const source = byCaseId.get(entry.caseId);
      if (!source) throw new Error(`caso desconhecido: ${entry.caseId}`);
      return {
        decisions: [
          buildDecisionForExpected(source, syntheticAmbiguousExpectation(), 0),
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
    revision: "self-test-2",
    resolve() {
      return { decisions: [] };
    },
  };
}

/** Resolvedor que falha em toda execução. */
export function createThrowingResolver(): CorpusResolverUnderTest {
  return {
    id: "self-test:throwing",
    revision: "self-test-2",
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
    revision: "self-test-2",
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
 * Sonda de vazamento do oráculo: tenta ler `expected` da entrada entregue pelo
 * harness. A entrada é sanitizada, então a leitura deve falhar sempre.
 */
export function createOracleLeakProbeResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const reference = createReferenceResolver(corpus);
  return {
    id: "self-test:oracle-leak-probe",
    revision: "self-test-2",
    async resolve(request) {
      const probe = request.case as unknown as Record<string, unknown>;
      const leaked = probe["expected"];
      if (leaked !== undefined) {
        throw new Error(
          "entrada do resolvedor expõe o resultado esperado (vazamento do oráculo)"
        );
      }
      if (Object.isFrozen(request.case) === false) {
        throw new Error("entrada do resolvedor não está congelada");
      }
      return reference.resolve(request);
    },
  };
}

/**
 * Resolvedor que declara escritas de conhecimento em casos reservados. Deve
 * bloquear a medição: holdout não alimenta aliases/prompts/promoção (§16.1).
 */
export function createHoldoutDeclaringWriterResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const reference = createReferenceResolver(corpus);
  return {
    id: "self-test:holdout-declaring-writer",
    revision: "self-test-2",
    async resolve(request) {
      const result = await reference.resolve(request);
      if (request.case.caseId.startsWith("c-aprendizado")) {
        return {
          ...result,
          knowledgeWrites: [`alias:${request.case.caseId}`],
        };
      }
      return result;
    },
  };
}

/**
 * Resolvedor que tenta escrever conhecimento **sem declarar** o efeito. A
 * fachada registra a tentativa e a rejeita, então o harness bloqueia mesmo sem
 * `knowledgeWrites` (§16.1).
 */
export function createHiddenHoldoutWriterResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const reference = createReferenceResolver(corpus);
  return {
    id: "self-test:holdout-hidden-writer",
    revision: "self-test-2",
    async resolve(request) {
      try {
        await request.knowledge.write(`alias:${request.case.caseId}`, "x");
      } catch {
        // A tentativa já está no ledger; o resolvedor segue como se nada
        // tivesse acontecido, exatamente como um efeito colateral oculto.
      }
      return reference.resolve(request);
    },
  };
}

/**
 * Resolvedor que inventa identidade e quantidade em decisões que **não**
 * propõem. Deve reprovar: ausência declarada é obrigação, não omissão tolerada.
 */
export function createInventedIdentityResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const reference = createReferenceResolver(corpus);
  return {
    id: "self-test:invented-identity",
    revision: "self-test-2",
    async resolve(request) {
      const result = await reference.resolve(request);
      return {
        ...result,
        decisions: result.decisions.map(decision =>
          decision.nextAction === "propose"
            ? decision
            : {
                ...decision,
                identity: {
                  ...decision.identity,
                  candidateKey: "cand-inventado",
                  foodEntityId: 4242,
                  canonicalName: "identidade-inventada",
                  qualifiers: [
                    {
                      value: "inventado",
                      attributeCode: null,
                      role: null,
                      confidence: null,
                    },
                  ],
                },
                quantity: {
                  ...decision.quantity,
                  value: 999,
                  unit: "g",
                  grams: 999,
                },
              }
        ),
      };
    },
  };
}

/**
 * Resolvedor que troca as alternativas preservadas por alternativas inventadas.
 * Deve reprovar: preservação de alternativas é semântica (§4.1.8).
 */
export function createInventedAlternativesResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const reference = createReferenceResolver(corpus);
  return {
    id: "self-test:invented-alternatives",
    revision: "self-test-2",
    async resolve(request) {
      const result = await reference.resolve(request);
      return {
        ...result,
        decisions: result.decisions.map(decision =>
          decision.alternatives.length === 0
            ? decision
            : {
                ...decision,
                alternatives: decision.alternatives.map(
                  (alternative, index) => ({
                    ...alternative,
                    name: `alternativa-inventada-${index + 1}`,
                  })
                ),
              }
        ),
      };
    },
  };
}

/**
 * Resolvedor que altera a procedência nutricional para uma origem não
 * sustentada. Deve reprovar onde o corpus declara origem permitida.
 */
export function createNutritionOriginDriftResolver(
  corpus: GoldenCorpus
): CorpusResolverUnderTest {
  const byCaseId = corpusIndex(corpus);
  return {
    id: "self-test:nutrition-origin-drift",
    revision: "self-test-2",
    resolve({ case: entry }) {
      const source = byCaseId.get(entry.caseId);
      if (!source) throw new Error(`caso desconhecido: ${entry.caseId}`);
      return {
        decisions: source.expected.decisions.map((expected, index) =>
          buildDecisionForExpected(source, expected, index, {
            nutritionOrigin: "ai_estimate",
          })
        ),
        operation: operationFor(source),
      };
    },
  };
}
