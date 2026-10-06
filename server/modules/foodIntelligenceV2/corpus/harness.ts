/**
 * Harness do Golden Food Corpus (issue #1299).
 *
 * Fonte canônica: `docs/design-docs/adr-food-intelligence-resolver-v2.md`
 * §1.1, §4.1.8, §8.12, §16, §16.1, §16.2, §17, §18 e §20.
 *
 * O harness:
 * - entrega ao resolvedor sob teste uma entrada **sanitizada** (sem `expected`,
 *   sem partição, sem rótulos) e recebe a decisão dele; nunca fabrica a decisão
 *   final (§18) nem permite que o resolvedor copie o oráculo;
 * - entrega conhecimento apenas por uma fachada instrumentada: fora da fase de
 *   aquisição, escrita é registrada e bloqueada (§16.1);
 * - compara a projeção semântica (§4.1.8) com o resultado esperado declarado de
 *   forma independente, distinguindo campo esperado, proibido e não afirmado;
 * - calcula a meta de §1.1 sobre todos os casos rotulados como resolvíveis,
 *   inclusive abstenções e falhas, e trata denominador zero como amostra
 *   ausente, nunca como zero;
 * - produz relatório por modalidade, classe de decisão, partição, classe de
 *   não-recorrência (§9.3), marca, atributo material, medida, continuidade,
 *   operação e procedência nutricional (§16.2), além das famílias de falha
 *   (identidade/variante, quantidade/unidade, fonte, operação, clarificação) e
 *   de latência/custo;
 * - executa os cenários de §16.1 com fases ordenadas (estado anterior,
 *   aquisição, medição reservada, reinício, precedência explícita, isolamento e
 *   revogação) contra a mesma instância do resolvedor;
 * - verifica equivalência de superfície **contra a referência independente** e
 *   reprova quando duas entradas convergem para o mesmo resultado errado;
 * - não aprova threshold numérico: a tolerância de arredondamento de macros é
 *   `OPEN` (§25 item 30) e sua ausência bloqueia em vez de ser preenchida.
 */
import {
  CORPUS_LEARNING_PHASES,
  CORPUS_REVISION_KEYS,
  GOLDEN_CORPUS_MIN_MATCH_RATE,
  CORPUS_UNPINNED_REVISIONS,
  goldenCorpusSchema,
  isUnpinnedRevision,
  toCorpusCaseInput,
  type CorpusCaseInput,
  type CorpusContinuity,
  type CorpusDecisionClass,
  type CorpusFailureCode,
  type CorpusGateBlockReason,
  type CorpusGateStatus,
  type CorpusKnowledgeGate,
  type CorpusKnowledgeLedgerEntry,
  type CorpusLearningPhase,
  type CorpusRevisions,
  type CorpusResolverMetrics,
  type CorpusResolverResult,
  type CorpusResolverUnderTest,
  type CorpusSegmentDimension,
  type CorpusSplit,
  type ExpectedDecision,
  type GoldenCorpus,
  type GoldenCorpusCase,
  type GoldenLearningScenario,
} from "./contracts";
import { goldenFoodCorpus } from "./data";
import {
  classifyMeasureKind,
  decisionsSemanticallyEqual,
  materialAttributeKey,
  projectDecision,
  projectExpectedDecision,
  projectionMultisetEqual,
  type ProjectedDecision,
} from "./projection";
import {
  foodMealOperationSchema,
  foodResolutionDecisionSchema,
  type FoodResolutionDecision,
  type MealOperation,
} from "../schemas";

/**
 * Valida a amostra de latência/custo reportada pelo resolvedor (§16.2).
 * Latência ou custo não finito, negativo ou de tipo errado é falha declarada:
 * o relatório não agrega número inválido, e `NaN` não pode virar `null` no
 * JSON mantendo a contagem de amostras.
 */
function validateMetrics(
  caseId: string,
  metrics: unknown
): CorpusFailure | null {
  // Ausência (`undefined`) é permitida; presença com valor inválido — inclusive
  // `null`, que não é `CorpusResolverMetrics` — é falha declarada.
  if (metrics === undefined) return null;
  if (
    metrics === null ||
    typeof metrics !== "object" ||
    Array.isArray(metrics)
  ) {
    return {
      caseId,
      label: null,
      codes: ["metrics_invalid"],
      detail: `métricas não são objeto válido: ${metrics === null ? "null" : typeof metrics}`,
    };
  }
  const sample = metrics as CorpusResolverMetrics;
  const offenders: string[] = [];
  if (sample.latencyMs !== undefined) {
    if (
      typeof sample.latencyMs !== "number" ||
      !Number.isFinite(sample.latencyMs) ||
      sample.latencyMs < 0
    ) {
      offenders.push(`latencyMs=${String(sample.latencyMs)}`);
    }
  }
  if (sample.costUsd !== undefined) {
    if (
      typeof sample.costUsd !== "number" ||
      !Number.isFinite(sample.costUsd) ||
      sample.costUsd < 0
    ) {
      offenders.push(`costUsd=${String(sample.costUsd)}`);
    }
  }
  if (offenders.length === 0) return null;
  return {
    caseId,
    label: null,
    codes: ["metrics_invalid"],
    detail: `métrica inválida descartada da agregação: ${offenders.join(", ")}`,
  };
}

/**
 * Opções de execução da medição.
 *
 * A tolerância de arredondamento de macros **não** é opção: ela é `OPEN` (§25
 * item 30) e por isso a divergência de macros bloqueia sempre. Aceitar um
 * número configurável (inclusive `Infinity`) transformaria um item `OPEN` em
 * threshold aprovado sem decisão registrada.
 */
export interface CorpusRunOptions {
  /** Revisões fixadas da medição (§16.1): código, conhecimento, léxico, modelo, política. */
  revisions: CorpusRevisions;
}

export const DEFAULT_CORPUS_RUN_OPTIONS: CorpusRunOptions = {
  revisions: CORPUS_UNPINNED_REVISIONS,
};

/**
 * Tolerância de arredondamento de macros vigente. Fixa em `null` enquanto §25
 * item 30 permanecer `OPEN`: a calibração será introduzida por decisão própria,
 * com fonte declarada, e não por parâmetro de execução.
 */
export const CORPUS_ROUNDING_TOLERANCE: number | null = null;

/** Falha classificada do harness. */
export interface CorpusFailure {
  caseId: string;
  /** Rótulo da decisão esperada; `null` para falha no nível do caso. */
  label: string | null;
  codes: CorpusFailureCode[];
  detail: string;
}

/** Contadores por família de verificação de §16.2. */
export interface CorpusFamilyCounters {
  identityFailures: number;
  variantAttributeFailures: number;
  quantityFailures: number;
  unitFailures: number;
  nutritionFailures: number;
  operationFailures: number;
  clarificationFailures: number;
  classificationFailures: number;
  unexpectedDecisions: number;
}

/** Métricas de um segmento do relatório (§16.2). */
export interface CorpusSegmentMetrics {
  dimension: CorpusSegmentDimension;
  segment: string;
  /** Casos no segmento. */
  cases: number;
  /** Casos rotulados como resolvíveis: denominador da meta de §1.1. */
  resolvableLabeled: number;
  /** Casos que exigiram clarificação. */
  clarificationLabeled: number;
  /** Casos que exigiram rejeição. */
  rejectionLabeled: number;
  /** Casos diferidos (retry/resiliência). */
  deferredLabeled: number;
  /** Casos cujo resultado esperado foi integralmente verificado. */
  matchedCases: number;
  failedCases: number;
  /** Abstenções: o resolvedor não devolveu decisão utilizável. */
  abstentions: number;
  /** `matchedResolvable / resolvableLabeled`; `null` quando o denominador é zero. */
  matchRate: number | null;
  /** `matchedCases / cases`; verifica também clarificação e rejeição. */
  decisionMatchRate: number | null;
  sampleStatus: "present" | "missing";
  families: CorpusFamilyCounters;
  /** Latência agregada; `null` quando o resolvedor não a reporta. */
  totalLatencyMs: number | null;
  latencySamples: number;
  /** Custo agregado; `null` quando o resolvedor não o reporta. */
  totalCostUsd: number | null;
  costSamples: number;
}

/** Resultado de um grupo metamórfico de equivalência de superfície (§17). */
export interface MetamorphicGroupResult {
  groupId: string;
  memberCaseIds: string[];
  splits: CorpusSplit[];
  /** Todos os membros verificados contra a referência independente. */
  allMatchReference: boolean;
  /** Todos os membros produzem a mesma projeção semântica. */
  converged: boolean;
  /** Convergiram entre si, mas contra a referência: reprova (§4.1.8). */
  wrongConvergence: boolean;
  failures: CorpusFailure[];
}

/**
 * Evidência de controle negativo. Não é apenas um booleano: registra a
 * implementação errada plausível que o controle precisa reprovar, a dimensão
 * discriminante, o resultado observado e as revisões do material medido.
 */
export interface NegativeControlEvidence {
  caseId: string;
  targetCaseId: string;
  /** Implementação errada plausível declarada pelo corpus. */
  hypothesis: string;
  /**
   * `false` quando algum dos lados não produziu decisão: sem saída não existe
   * evidência de discriminação, e o controle conta como não discriminante.
   */
  executed: boolean;
  /** `true` quando o controle não converge para a saída do alvo. */
  discriminating: boolean;
  /** Primeira dimensão em que as duas saídas divergem. */
  discriminatingDimension: string;
  controlSignature: string;
  targetSignature: string;
  revisions: CorpusRevisions;
}

/** Consistência de macros entre entradas equivalentes (§1.1). */
export interface MacroConsistencyResult {
  groupId: string;
  consistent: boolean;
  divergences: string[];
}

/** Resultado de um passo de cenário de aprendizado (§16.1). */
export interface LearningScenarioStepResult {
  stepId: string;
  phase: CorpusLearningPhase;
  caseId: string;
  allowLearning: boolean;
  writesAllowed: boolean;
  matched: boolean;
  /** Tentativas de escrita registradas pela fachada de conhecimento. */
  recordedWriteAttempts: number;
  sameResultAsStepId: string | null;
  sameResultSatisfied: boolean | null;
  differentFromStepId: string | null;
  differentFromSatisfied: boolean | null;
  failures: CorpusFailure[];
}

/** Resultado de um cenário de aprendizado/generalização de §16.1. */
export interface LearningScenarioResult {
  scenarioId: string;
  ownerRefs: string[];
  conversationRefs: string[];
  phases: CorpusLearningPhase[];
  steps: LearningScenarioStepResult[];
  passed: boolean;
  failures: CorpusFailure[];
}

/** Integridade do corpus antes da medição (§16.1, §16.2, §17). */
export interface CorpusIntegrityReport {
  status: "valid" | "invalid";
  duplicateCaseIds: string[];
  duplicateSurfaces: { key: string; caseIds: string[] }[];
  splitLeakage: { key: string; caseIds: string[]; splits: CorpusSplit[] }[];
  undeclaredEquivalence: string[];
  invalidGroups: { groupId: string; reason: string }[];
  negativeControlConflicts: string[];
  invalidCases: { caseId: string; message: string }[];
  /** Grupos metamórficos cujos membros declaram resultados diferentes. */
  divergentGroupExpectations: { groupId: string; caseIds: string[] }[];
  /** Cenários de §16.1 inválidos (passo ausente, fase insuficiente, etc.). */
  invalidScenarios: { scenarioId: string; message: string }[];
  /** Escritas de conhecimento observadas fora da fase de aquisição. */
  holdoutKnowledgeWrites: { caseId: string; writes: string[] }[];
}

/** Veredito do gate do corpus. */
export interface CorpusGate {
  status: CorpusGateStatus;
  minMatchRate: number;
  matchRate: number | null;
  failureCount: number;
  /** Falhas fora dos casos resolvíveis: nunca cobertas pela meta de §1.1. */
  nonResolvableFailureCount: number;
  blockReasons: CorpusGateBlockReason[];
}

/** Relatório reproduzível do harness. */
export interface CorpusReport {
  corpusVersion: string;
  corpusSchemaVersion: number;
  resolver: { id: string; revision: string };
  revisions: CorpusRevisions;
  caseCount: number;
  /** Invariante de §18: cada caso passou pelo resolvedor sob teste. */
  resolveCalls: number;
  integrity: CorpusIntegrityReport;
  overall: CorpusSegmentMetrics;
  byModality: CorpusSegmentMetrics[];
  byDecisionClass: CorpusSegmentMetrics[];
  bySplit: CorpusSegmentMetrics[];
  byNonRecurrenceClass: CorpusSegmentMetrics[];
  byBrand: CorpusSegmentMetrics[];
  byMaterialAttribute: CorpusSegmentMetrics[];
  byMeasure: CorpusSegmentMetrics[];
  byContinuity: CorpusSegmentMetrics[];
  byOperation: CorpusSegmentMetrics[];
  byNutritionSource: CorpusSegmentMetrics[];
  failures: CorpusFailure[];
  metamorphic: MetamorphicGroupResult[];
  negativeControls: NegativeControlEvidence[];
  macroConsistency: MacroConsistencyResult[];
  learningScenarios: LearningScenarioResult[];
  gate: CorpusGate;
}

interface CaseOutcome {
  case: GoldenCorpusCase;
  matched: boolean;
  abstained: boolean;
  failures: CorpusFailure[];
  projections: ProjectedDecision[];
  operation: MealOperation | null;
  rawDecisions: FoodResolutionDecision[];
  latencyMs: number | null;
  costUsd: number | null;
}

const SPLIT_SEPARATOR = "\u0000";

/** Normaliza a superfície para detecção de duplicata e vazamento (§16.2). */
function surfaceKey(entry: GoldenCorpusCase): string {
  const source =
    entry.input.transcription ?? entry.input.ocrText ?? entry.input.text;
  return [
    entry.scenario.ownerRef,
    entry.scenario.conversationRef,
    entry.modality,
    source
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  ].join(SPLIT_SEPARATOR);
}

/**
 * Classe de decisão derivada das decisões esperadas: `resolvable` exige que
 * todas proponham. Qualquer `reject` produz `rejection`; `clarify` produz
 * `clarification`; `retry` produz `deferred`.
 */
export function deriveDecisionClass(
  decisions: readonly ExpectedDecision[]
): CorpusDecisionClass {
  if (decisions.some(item => item.nextAction === "reject")) return "rejection";
  if (decisions.some(item => item.nextAction === "clarify")) {
    return "clarification";
  }
  if (decisions.every(item => item.nextAction === "propose")) {
    return "resolvable";
  }
  return "deferred";
}

/** Agrupa códigos de falha nas famílias de §16.2. */
export function familyCounters(
  failures: readonly CorpusFailure[]
): CorpusFamilyCounters {
  const codes = new Set(failures.flatMap(failure => failure.codes));
  const has = (...candidates: CorpusFailureCode[]) =>
    candidates.some(candidate => codes.has(candidate));
  return {
    identityFailures: has(
      "identity_mismatch",
      "brand_mismatch",
      "barcode_mismatch",
      "identity_present_unexpected"
    )
      ? 1
      : 0,
    variantAttributeFailures: has(
      "variant_mismatch",
      "preparation_mismatch",
      "qualifiers_mismatch"
    )
      ? 1
      : 0,
    quantityFailures: has(
      "quantity_mismatch",
      "quantity_present_unexpected",
      "quantity_became_grams"
    )
      ? 1
      : 0,
    unitFailures: has("quantity_unit_mismatch", "measure_kind_mismatch")
      ? 1
      : 0,
    nutritionFailures: has(
      "nutrition_missing",
      "nutrition_provenance_missing",
      "nutrition_origin_forbidden",
      "nutrition_generic_as_verified",
      "nutrition_present_unexpected",
      "provisional_declaration_missing"
    )
      ? 1
      : 0,
    operationFailures: has(
      "operation_missing",
      "operation_mismatch",
      "operation_invalid"
    )
      ? 1
      : 0,
    classificationFailures: has(
      "classification_missing",
      "classification_unversioned",
      "classification_mismatch"
    )
      ? 1
      : 0,
    clarificationFailures: has(
      "clarification_mismatch",
      "unresolved_fields_mismatch",
      "alternatives_lost",
      "alternatives_mismatch",
      "reason_code_missing",
      "reason_code_forbidden"
    )
      ? 1
      : 0,
    unexpectedDecisions: codes.has("unexpected_decision") ? 1 : 0,
  };
}

function emptyFamilies(): CorpusFamilyCounters {
  return {
    identityFailures: 0,
    variantAttributeFailures: 0,
    quantityFailures: 0,
    unitFailures: 0,
    nutritionFailures: 0,
    operationFailures: 0,
    clarificationFailures: 0,
    classificationFailures: 0,
    unexpectedDecisions: 0,
  };
}

function addFamilies(
  a: CorpusFamilyCounters,
  b: CorpusFamilyCounters
): CorpusFamilyCounters {
  return {
    identityFailures: a.identityFailures + b.identityFailures,
    variantAttributeFailures:
      a.variantAttributeFailures + b.variantAttributeFailures,
    quantityFailures: a.quantityFailures + b.quantityFailures,
    unitFailures: a.unitFailures + b.unitFailures,
    nutritionFailures: a.nutritionFailures + b.nutritionFailures,
    operationFailures: a.operationFailures + b.operationFailures,
    clarificationFailures: a.clarificationFailures + b.clarificationFailures,
    classificationFailures: a.classificationFailures + b.classificationFailures,
    unexpectedDecisions: a.unexpectedDecisions + b.unexpectedDecisions,
  };
}

/** Chaves de segmentação derivadas do caso (§16.2). */
export interface CaseSegmentKeys {
  modality: string;
  decisionClass: string;
  split: string;
  nonRecurrenceClass: string[];
  brand: string;
  materialAttribute: string;
  measure: string;
  continuity: CorpusContinuity;
  operation: string;
  nutritionSource: string;
}

/** Deriva as dimensões de segmentação do caso sem olhar a saída do resolvedor. */
export function segmentKeysOf(entry: GoldenCorpusCase): CaseSegmentKeys {
  const brands = new Set<string>();
  const materials = new Set<string>();
  const measures = new Set<string>();
  const nutritionSources = new Set<string>();

  for (const expected of entry.expected.decisions) {
    const projected = projectExpectedDecision(expected);
    brands.add(projected.identity.brand ?? "none");
    materials.add(materialAttributeKey(projected.identity));
    measures.add(classifyMeasureKind(projected.quantity.unit));
    nutritionSources.add(expected.nutrition.requirement);
  }

  const nutritionSource = nutritionSources.has("provisional_declared")
    ? "provisional_declared"
    : nutritionSources.has("provenance_declared")
      ? "provenance_declared"
      : nutritionSources.has("absent")
        ? "absent"
        : "unspecified";

  return {
    modality: entry.modality,
    decisionClass: entry.decisionClass,
    split: entry.split,
    nonRecurrenceClass: [...entry.nonRecurrenceClasses],
    brand: brands.size === 1 ? [...brands][0] : "mixed",
    materialAttribute: materials.size === 1 ? [...materials][0] : "mixed",
    measure: measures.size === 1 ? [...measures][0] : "mixed",
    continuity: entry.continuity,
    operation: entry.expected.operation?.action ?? "unknown",
    nutritionSource,
  };
}

/** Verifica a integridade estrutural do corpus antes de medir. */
export function inspectCorpusIntegrity(
  corpus: GoldenCorpus
): CorpusIntegrityReport {
  const duplicateCaseIds: string[] = [];
  const invalidCases: { caseId: string; message: string }[] = [];
  const seenCaseIds = new Map<string, number>();

  for (const entry of corpus.cases) {
    seenCaseIds.set(entry.caseId, (seenCaseIds.get(entry.caseId) ?? 0) + 1);
  }
  for (const [caseId, count] of seenCaseIds) {
    if (count > 1) duplicateCaseIds.push(caseId);
  }

  const scenarioById = new Map(
    corpus.learningScenarios.map(scenario => [scenario.scenarioId, scenario])
  );
  const stepsByCase = new Map<string, { scenarioId: string; stepId: string }>();
  for (const scenario of corpus.learningScenarios) {
    for (const step of scenario.steps) {
      if (stepsByCase.has(step.caseId)) {
        invalidCases.push({
          caseId: step.caseId,
          message: `caso é passo de mais de um cenário (${scenario.scenarioId})`,
        });
      }
      stepsByCase.set(step.caseId, {
        scenarioId: scenario.scenarioId,
        stepId: step.stepId,
      });
    }
  }

  for (const entry of corpus.cases) {
    const derived = deriveDecisionClass(entry.expected.decisions);
    if (derived !== entry.decisionClass) {
      invalidCases.push({
        caseId: entry.caseId,
        message: `decisionClass=${entry.decisionClass} divergente da classe derivada ${derived}`,
      });
    }
    if (entry.metamorphicGroup && !entry.equivalenceReference) {
      invalidCases.push({
        caseId: entry.caseId,
        message:
          "caso em grupo metamórfico exige declaração de equivalência por referência independente (§4.1.8)",
      });
    }
    if (entry.negativeControlOf && entry.negativeControlOf === entry.caseId) {
      invalidCases.push({
        caseId: entry.caseId,
        message: "controle negativo não pode apontar para si mesmo",
      });
    }
    if (entry.negativeControlOf && !entry.negativeControlHypothesis) {
      invalidCases.push({
        caseId: entry.caseId,
        message:
          "controle negativo exige implementação errada plausível declarada (evidência adversarial)",
      });
    }

    // Ausência declarada não pode conviver com valores: "não afirmar" é um
    // estado explícito, não um escape (§4.1.8).
    for (const expected of entry.expected.decisions) {
      const proposes = expected.nextAction === "propose";
      // Rejeição e superfície desconhecida não podem sustentar identidade nem
      // inventar quantidade. `partially_resolved` + clarificação é diferente:
      // a identidade é conhecida e a porção é que está em aberto.
      const forbidsFields =
        expected.status === "unknown" || expected.nextAction === "reject";
      if (expected.identity.presence === "expected") {
        if (expected.identity.canonicalName === null) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' afirma identidade sem nome canônico`,
          });
        }
      }
      if (expected.quantity.presence === "expected") {
        if (expected.quantity.value === null) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' afirma quantidade sem valor`,
          });
        }
        if (
          expected.quantity.value !== null &&
          expected.quantity.unit === null
        ) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' afirma quantidade sem unidade explícita`,
          });
        }
      }
      if (!proposes) {
        if (forbidsFields && expected.identity.presence !== "forbidden") {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' (${expected.status}/${expected.nextAction}) exige identidade proibida, não '${expected.identity.presence}'`,
          });
        }
        if (
          forbidsFields
            ? expected.quantity.presence !== "forbidden"
            : expected.quantity.presence === "expected"
        ) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' (${expected.status}/${expected.nextAction}) não pode afirmar quantidade como 'expected'`,
          });
        }
        if (expected.nutrition.requirement !== "absent") {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' não propõe e por isso exige nutrição ausente, não '${expected.nutrition.requirement}'`,
          });
        }
      } else {
        if (expected.identity.presence !== "expected") {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão proposta '${expected.label}' exige identidade esperada (§9.2)`,
          });
        }
        if (
          expected.nutrition.requirement !== "provenance_declared" &&
          expected.nutrition.requirement !== "provisional_declared"
        ) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão proposta '${expected.label}' exige procedência nutricional declarada (§9.2)`,
          });
        }
      }

      if (expected.ambiguity.mustPreserveAlternatives) {
        if (expected.alternatives.length < expected.ambiguity.minAlternatives) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' exige alternativas declaradas para preservação semântica`,
          });
        }
        if (derived !== "clarification") {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' preserva alternativas e por isso é de clarificação`,
          });
        }
      } else if (expected.alternatives.length > 0) {
        invalidCases.push({
          caseId: entry.caseId,
          message: `decisão '${expected.label}' declara alternativas sem exigir preservação`,
        });
      }

      // Coerência da presença: `forbidden` exige ausência **de valores**, e
      // `unspecified` não pode carregar valor material — nos dois casos o valor
      // não seria comparado, e declará-lo transformaria a expectativa em
      // aparência de verificação.
      if (expected.identity.presence === "forbidden") {
        const declaredIdentity = [
          expected.identity.canonicalName,
          expected.identity.brand,
          expected.identity.variant,
          expected.identity.barcode,
        ].some(value => value !== null);
        if (
          declaredIdentity ||
          expected.identity.preparation.length > 0 ||
          expected.identity.qualifiers.length > 0
        ) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' declara identidade com presença '${expected.identity.presence}': valor não comparado não pode ser declarado`,
          });
        }
      }
      if (expected.quantity.presence !== "expected") {
        const declaredQuantity = [
          expected.quantity.value,
          expected.quantity.unit,
          expected.quantity.grams,
          expected.quantity.milliliters,
          expected.quantity.measureKind,
        ].some(value => value !== null);
        if (declaredQuantity) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' declara quantidade com presença '${expected.quantity.presence}': valor não comparado não pode ser declarado`,
          });
        }
      }
      // `unspecified` só é legítimo quando a superfície realmente não declara
      // quantidade **e** o item é proposto com porção usual (§8.3). Fora disso
      // ele esconderia um campo material.
      if (expected.quantity.presence === "unspecified") {
        if (!proposes || expected.status !== "resolved") {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' (${expected.status}/${expected.nextAction}) não pode deixar a quantidade sem comparação`,
          });
        }
        const signal = quantitySignalOf(entry);
        if (signal !== null) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `superfície declara quantidade ('${signal}') e por isso a quantidade não pode ficar 'unspecified'`,
          });
        }
      }
      // Classificação: conteúdo declarado ou invariante estrutural declarada.
      if (expected.classification.measured) {
        const declared = [
          expected.classification.processingLevel,
          expected.classification.isFruit,
          expected.classification.isVegetable,
          expected.classification.isUltraProcessed,
        ];
        if (declared.some(value => value === null)) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' mede classificação e precisa declarar nível de processamento, fruta, hortaliça e ultraprocessado`,
          });
        }
        if (!entry.nonRecurrenceClasses.includes("J")) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' mede classificação e por isso declara a classe J de §9.3`,
          });
        }
      } else if (
        expected.classification.processingLevel !== null ||
        expected.classification.isFruit !== null ||
        expected.classification.isVegetable !== null ||
        expected.classification.isUltraProcessed !== null ||
        expected.classification.provisionalRequired
      ) {
        invalidCases.push({
          caseId: entry.caseId,
          message: `decisão '${expected.label}' não mede classificação e não pode declarar valores`,
        });
      }
      // Toda classe J do corpus precisa medir classificação de fato.
      if (
        entry.nonRecurrenceClasses.includes("J") &&
        !entry.expected.decisions.some(
          decision => decision.classification.measured
        )
      ) {
        invalidCases.push({
          caseId: entry.caseId,
          message:
            "classe J de §9.3 exige pelo menos uma decisão que meça classificação",
        });
      }
      // Exclusão precisa de motivo estruturado, independentemente de a
      // explicação das exclusões ser exigida (§7.2, §9.2).
      if (!proposes && expected.reasonCodes.length === 0) {
        invalidCases.push({
          caseId: entry.caseId,
          message: `decisão '${expected.label}' não propõe e por isso precisa declarar código de motivo`,
        });
      }
      if (expected.nutrition.requirement === "absent") {
        if (
          expected.nutrition.allowedOrigins.length > 0 ||
          expected.nutrition.forbiddenOrigins.length > 0 ||
          expected.nutrition.provisionalRequired ||
          expected.nutrition.genericProfileMustNotBeVerified
        ) {
          invalidCases.push({
            caseId: entry.caseId,
            message: `decisão '${expected.label}' exige nutrição ausente e não pode declarar restrição de origem`,
          });
        }
      }
    }

    const expectedStep = stepsByCase.get(entry.caseId);
    if (entry.learningScenarioId !== null) {
      const scenario = scenarioById.get(entry.learningScenarioId);
      if (!scenario) {
        invalidCases.push({
          caseId: entry.caseId,
          message: `learningScenarioId=${entry.learningScenarioId} não existe`,
        });
      }
      if (
        !expectedStep ||
        expectedStep.scenarioId !== entry.learningScenarioId
      ) {
        invalidCases.push({
          caseId: entry.caseId,
          message:
            "caso declara cenário de aprendizado mas não é passo declarado desse cenário",
        });
      }
      if (entry.continuity !== "continues_context") {
        invalidCases.push({
          caseId: entry.caseId,
          message:
            "caso de cenário de aprendizado exige continuidade 'continues_context'",
        });
      }
    } else if (expectedStep) {
      invalidCases.push({
        caseId: entry.caseId,
        message: `caso é passo do cenário ${expectedStep.scenarioId} mas não o declara`,
      });
    }
  }

  const invalidScenarios: { scenarioId: string; message: string }[] = [];
  for (const scenario of corpus.learningScenarios) {
    invalidScenarios.push(...validateScenario(scenario, seenCaseIds));
  }

  const bySurface = new Map<string, GoldenCorpusCase[]>();
  for (const entry of corpus.cases) {
    const key = surfaceKey(entry);
    const list = bySurface.get(key) ?? [];
    list.push(entry);
    bySurface.set(key, list);
  }
  const indexByCase = new Map(
    corpus.cases.map((entry, index) => [entry.caseId, index])
  );
  const groupToken = (entry: GoldenCorpusCase): string =>
    entry.learningScenarioId ??
    entry.metamorphicGroup ??
    `solo:${indexByCase.get(entry.caseId) ?? entry.caseId}`;

  const duplicateSurfaces: { key: string; caseIds: string[] }[] = [];
  const splitLeakage: {
    key: string;
    caseIds: string[];
    splits: CorpusSplit[];
  }[] = [];

  for (const [key, entries] of bySurface) {
    if (entries.length < 2) continue;

    // Membros do mesmo grupo metamórfico (ou passos do mesmo cenário)
    // compartilham a superfície normalizada por declaração da referência
    // independente (§4.1.8): a variação é intencional, não duplicata.
    const distinctGroups = new Set(entries.map(groupToken));
    const isDeclaredVariation = distinctGroups.size === 1;

    const sameSplit = new Map<CorpusSplit, GoldenCorpusCase[]>();
    for (const entry of entries) {
      const list = sameSplit.get(entry.split) ?? [];
      list.push(entry);
      sameSplit.set(entry.split, list);
    }
    if (!isDeclaredVariation) {
      const withinSplit = [...sameSplit.values()]
        .filter(list => list.length > 1)
        .flat()
        .map(entry => entry.caseId);
      if (withinSplit.length > 0) {
        duplicateSurfaces.push({ key, caseIds: withinSplit.sort() });
      }
    }

    // Repetição intencional da mesma superfície/chave é exigida por §16.1
    // (persistência/restart e revogação). Fora dela, a mesma superfície em
    // partições diferentes vaza a resposta para o holdout (§16.2).
    const undeclared = entries.filter(
      entry => !entry.scenario.intentionalSurfaceReuse
    );
    const undeclaredSplits = [...new Set(undeclared.map(entry => entry.split))];
    if (
      undeclaredSplits.length > 1 &&
      new Set(undeclared.map(groupToken)).size > 1
    ) {
      splitLeakage.push({
        key,
        caseIds: undeclared.map(entry => entry.caseId).sort(),
        splits: undeclaredSplits.sort(),
      });
    }
  }

  const groups = new Map<string, GoldenCorpusCase[]>();
  for (const entry of corpus.cases) {
    if (!entry.metamorphicGroup) continue;
    const list = groups.get(entry.metamorphicGroup) ?? [];
    list.push(entry);
    groups.set(entry.metamorphicGroup, list);
  }

  const invalidGroups: { groupId: string; reason: string }[] = [];
  const divergentGroupExpectations: { groupId: string; caseIds: string[] }[] =
    [];
  const undeclaredEquivalence: string[] = [];
  for (const [groupId, entries] of groups) {
    if (entries.length < 2) {
      invalidGroups.push({
        groupId,
        reason:
          "grupo metamórfico precisa de pelo menos dois membros equivalentes",
      });
    }
    const holdoutMembers = entries.filter(entry => entry.split === "holdout");
    if (holdoutMembers.length > 0 && holdoutMembers.length === entries.length) {
      invalidGroups.push({
        groupId,
        reason:
          "grupo totalmente reservado não mede generalização a partir de conhecimento adquirido (§16.1)",
      });
    }
    for (const entry of entries) {
      if (!entry.equivalenceReference) undeclaredEquivalence.push(entry.caseId);
    }

    // Um grupo metamórfico só é válido se os membros declararem o **mesmo**
    // resultado esperado. Caso contrário não é equivalência: é conflito.
    const reference = entries[0];
    const referenceProjection = reference.expected.decisions.map(
      projectExpectedDecision
    );
    const divergent = entries.filter(entry => {
      const projection = entry.expected.decisions.map(projectExpectedDecision);
      // Decisões **e** operação material de refeição precisam coincidir: dois
      // membros que agem em refeições diferentes não são a mesma superfície
      // medida duas vezes. A **data** é contexto declarado e pode variar — o
      // grupo de §16.1 mede generalização para outro dia —, e por isso não
      // entra na equivalência (a operação é segmentada à parte em §16.2).
      const sameOperation =
        entry.expected.operation?.action ===
          reference.expected.operation?.action &&
        entry.expected.operation?.targetMeal ===
          reference.expected.operation?.targetMeal;
      return (
        !sameOperation ||
        !projectionMultisetEqual(projection, referenceProjection)
      );
    });
    if (divergent.length > 0) {
      divergentGroupExpectations.push({
        groupId,
        caseIds: divergent.map(entry => entry.caseId).sort(),
      });
    }
  }

  const negativeControlConflicts: string[] = [];
  const byCaseId = new Map(corpus.cases.map(entry => [entry.caseId, entry]));
  for (const entry of corpus.cases) {
    if (!entry.negativeControlOf) continue;
    const target = byCaseId.get(entry.negativeControlOf);
    if (!target) {
      negativeControlConflicts.push(
        `${entry.caseId}: aponta para caso inexistente ${entry.negativeControlOf}`
      );
      continue;
    }
    if (
      entry.metamorphicGroup &&
      target.metamorphicGroup === entry.metamorphicGroup
    ) {
      negativeControlConflicts.push(
        `${entry.caseId}: controle negativo não pode pertencer ao mesmo grupo metamórfico do alvo (§4.1.8)`
      );
    }
  }

  const status =
    duplicateCaseIds.length === 0 &&
    duplicateSurfaces.length === 0 &&
    splitLeakage.length === 0 &&
    undeclaredEquivalence.length === 0 &&
    invalidGroups.length === 0 &&
    divergentGroupExpectations.length === 0 &&
    negativeControlConflicts.length === 0 &&
    invalidScenarios.length === 0 &&
    invalidCases.length === 0
      ? "valid"
      : "invalid";

  return {
    status,
    duplicateCaseIds: [...duplicateCaseIds].sort(),
    duplicateSurfaces,
    splitLeakage,
    undeclaredEquivalence: [...undeclaredEquivalence].sort(),
    invalidGroups,
    negativeControlConflicts,
    invalidCases,
    divergentGroupExpectations,
    invalidScenarios,
    holdoutKnowledgeWrites: [],
  };
}

/**
 * Vocabulário de quantidade reconhecido na superfície. É um sinal de
 * integridade do corpus, não um normalizador: serve para impedir que um caso
 * declare `unspecified` sobre uma superfície que declara quantidade.
 */
const QUANTITY_SIGNAL_PATTERN =
  /\b(um|uma|uns|umas|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meia|meio|metade|par|pouco|pouca|pouquinho|pouquinha|alguns|algumas|bastante|por[çc][ãa]o|por[çc][õo]es|fatias?|colheres?|colher|conchas?|copos?|x[íi]caras?|unidades?|prato|prat[ãa]o|tigela|punhado|tiquinho|dose|doses|gramas?|quilos?|mililitros?|litros?|g|kg|ml|l)\b/i;

/** Contextos que usam dígitos sem declarar quantidade consumida. */
const NON_QUANTITY_DIGIT_PATTERN =
  /\b(vers[ãa]o|version|v|n[ºo]|n[úu]mero|item|c[óo]digo|id|telefone|cep|cpf|ano|sala|lote|nota)\s*[:.]?\s*\d+\b/gi;

function quantitySignalOf(entry: GoldenCorpusCase): string | null {
  // Somente superfícies **declaradas pelo usuário** contam como quantidade
  // consumida. `ocrText` é evidência do produto (por exemplo o peso da
  // embalagem) e não afirma a porção consumida; datas, horas, versões e
  // identificadores também não são quantidade.
  //
  // O detector é deliberadamente **assimétrico**: quantidade por extenso
  // ("uma maçã", "meia porção") conta tanto quanto dígitos, porque uma
  // quantidade material escondida atrás de `unspecified` é o risco que a
  // integridade existe para impedir.
  const surfaces = [
    entry.input.text,
    entry.input.transcription,
    entry.input.caption,
  ].filter((value): value is string => value !== null);
  for (const surface of surfaces) {
    const cleaned = surface
      .replace(/\d{4}-\d{2}-\d{2}/g, " ")
      .replace(/\d{1,2}:\d{2}/g, " ")
      .replace(NON_QUANTITY_DIGIT_PATTERN, " ");
    const word = QUANTITY_SIGNAL_PATTERN.exec(cleaned);
    if (word) return word[0];
    const digit = /\d/.exec(cleaned);
    if (digit) return digit[0];
  }
  return null;
}

function validateScenario(
  scenario: GoldenLearningScenario,
  knownCaseIds: ReadonlyMap<string, number>
): { scenarioId: string; message: string }[] {
  const issues: { scenarioId: string; message: string }[] = [];
  const phases = new Set(scenario.steps.map(step => step.phase));

  if (!phases.has("acquisition")) {
    issues.push({
      scenarioId: scenario.scenarioId,
      message: "cenário de §16.1 exige passo de aquisição de conhecimento",
    });
  }
  const provingPhases: CorpusLearningPhase[] = [
    "restart",
    "isolation",
    "revocation",
    "explicit_override",
    "reserved_measurement",
  ];
  if (!provingPhases.some(phase => phases.has(phase))) {
    issues.push({
      scenarioId: scenario.scenarioId,
      message:
        "cenário de §16.1 exige passo de medição reservada, reinício, precedência, isolamento ou revogação",
    });
  }

  const stepIds = new Set(scenario.steps.map(step => step.stepId));
  for (const step of scenario.steps) {
    if (!knownCaseIds.has(step.caseId)) {
      issues.push({
        scenarioId: scenario.scenarioId,
        message: `passo ${step.stepId} aponta para caso inexistente ${step.caseId}`,
      });
    }
    if (step.writesAllowed !== (step.phase === "acquisition")) {
      issues.push({
        scenarioId: scenario.scenarioId,
        message: `passo ${step.stepId}: escrita só é permitida na fase de aquisição (§16.1)`,
      });
    }
    if (step.sameResultAsStepId && !stepIds.has(step.sameResultAsStepId)) {
      issues.push({
        scenarioId: scenario.scenarioId,
        message: `passo ${step.stepId}: sameResultAsStepId desconhecido`,
      });
    }
    if (step.differentFromStepId && !stepIds.has(step.differentFromStepId)) {
      issues.push({
        scenarioId: scenario.scenarioId,
        message: `passo ${step.stepId}: differentFromStepId desconhecido`,
      });
    }
    if (step.sameResultAsStepId === step.stepId) {
      issues.push({
        scenarioId: scenario.scenarioId,
        message: `passo ${step.stepId} não pode comparar consigo mesmo`,
      });
    }
  }

  // Estrutura mínima por fase: um passo só é prova se declarar o efeito
  // observável que §16.1 exige. Sem isso, "cenário" vira rótulo de caso.
  const order = (phase: CorpusLearningPhase) =>
    CORPUS_LEARNING_PHASES.indexOf(phase);
  for (let index = 1; index < scenario.steps.length; index += 1) {
    const previous = scenario.steps[index - 1];
    const current = scenario.steps[index];
    if (order(current.phase) < order(previous.phase)) {
      issues.push({
        scenarioId: scenario.scenarioId,
        message: `passo ${current.stepId} fora da ordem de fases de §16.1 (${previous.phase} → ${current.phase})`,
      });
    }
  }
  const first = scenario.steps[0];
  if (first.phase !== "before_acquisition") {
    issues.push({
      scenarioId: scenario.scenarioId,
      message:
        "cenário de §16.1 precisa começar pelo estado anterior à aquisição",
    });
  }
  const acquisition = scenario.steps.find(step => step.phase === "acquisition");
  if (acquisition && acquisition.sameResultAsStepId !== null) {
    issues.push({
      scenarioId: scenario.scenarioId,
      message: `passo ${acquisition.stepId}: aquisição não é reprodução de outro passo`,
    });
  }
  const requiredInvariants: Record<
    CorpusLearningPhase,
    "same" | "different" | null
  > = {
    before_acquisition: null,
    acquisition: null,
    reserved_measurement: "same",
    restart: "same",
    explicit_override: "different",
    isolation: "different",
    revocation: "different",
  };
  for (const phase of Object.keys(
    requiredInvariants
  ) as CorpusLearningPhase[]) {
    const required = requiredInvariants[phase];
    if (required === null) continue;
    const steps = scenario.steps.filter(step => step.phase === phase);
    for (const step of steps) {
      if (required === "same" && step.sameResultAsStepId === null) {
        issues.push({
          scenarioId: scenario.scenarioId,
          message: `passo ${step.stepId} (${phase}) precisa declarar sameResultAsStepId`,
        });
      }
      if (required === "different" && step.differentFromStepId === null) {
        issues.push({
          scenarioId: scenario.scenarioId,
          message: `passo ${step.stepId} (${phase}) precisa declarar differentFromStepId`,
        });
      }
    }
  }
  const revocation = scenario.steps.find(step => step.phase === "revocation");
  if (revocation && revocation.revokeKeys.length === 0) {
    issues.push({
      scenarioId: scenario.scenarioId,
      message: `passo ${revocation.stepId}: revogação precisa declarar as chaves revogadas`,
    });
  }
  const proving = scenario.steps.find(
    step => step.differentFromStepId !== null
  );
  if (!proving) {
    issues.push({
      scenarioId: scenario.scenarioId,
      message:
        "cenário de §16.1 exige ao menos um passo que prove diferença observável",
    });
  }
  return issues;
}

/** Compara a decisão esperada com a projeção observada (§4.1.8). */
export function compareExpectedDecision(
  expected: ExpectedDecision,
  projected: ProjectedDecision
): CorpusFailureCode[] {
  const codes: CorpusFailureCode[] = [];

  if (expected.status !== projected.status) codes.push("status_mismatch");
  if (expected.nextAction !== projected.nextAction) {
    codes.push("next_action_mismatch");
  }

  switch (expected.identity.presence) {
    case "expected": {
      if (
        expected.identity.canonicalName !== projected.identity.canonicalName
      ) {
        codes.push("identity_mismatch");
      }
      if (expected.identity.brand !== projected.identity.brand) {
        codes.push("brand_mismatch");
      }
      if (expected.identity.variant !== projected.identity.variant) {
        codes.push("variant_mismatch");
      }
      if (
        !sameSet(expected.identity.preparation, projected.identity.preparation)
      ) {
        codes.push("preparation_mismatch");
      }
      if (
        !sameSet(
          expected.identity.qualifiers,
          projected.identity.qualifierValues
        )
      ) {
        codes.push("qualifiers_mismatch");
      }
      if (expected.identity.barcode !== projected.identity.barcode) {
        codes.push("barcode_mismatch");
      }
      break;
    }
    case "forbidden": {
      // Identidade proibida: uma decisão de rejeição/ambiguidade não pode
      // inventar identidade, nem por "aproximação".
      const hasIdentity =
        projected.identity.canonicalName !== null ||
        projected.identity.brand !== null ||
        projected.identity.variant !== null ||
        projected.identity.barcode !== null ||
        projected.identity.preparation.length > 0 ||
        projected.identity.qualifierValues.length > 0;
      if (hasIdentity) codes.push("identity_present_unexpected");
      break;
    }
  }

  switch (expected.quantity.presence) {
    case "expected": {
      if (expected.quantity.value !== projected.quantity.value) {
        codes.push("quantity_mismatch");
      }
      if (
        expected.quantity.unit !== null &&
        expected.quantity.unit !== projected.quantity.unit
      ) {
        codes.push("quantity_unit_mismatch");
      }
      if (
        expected.quantity.grams !== null &&
        expected.quantity.grams !== projected.quantity.grams
      ) {
        codes.push("quantity_mismatch");
      }
      if (
        expected.quantity.milliliters !== null &&
        expected.quantity.milliliters !== projected.quantity.milliliters
      ) {
        codes.push("quantity_mismatch");
      }
      if (
        expected.quantity.measureKind !== null &&
        expected.quantity.measureKind !== projected.quantity.measureKind
      ) {
        codes.push("measure_kind_mismatch");
      }
      if (expected.quantity.unitMustNotBeConvertedToGrams) {
        if (
          projected.quantity.grams !== null ||
          projected.quantity.unitIsMass
        ) {
          codes.push("quantity_became_grams");
        }
      }
      break;
    }
    case "forbidden": {
      const hasQuantity =
        projected.quantity.value !== null ||
        projected.quantity.grams !== null ||
        projected.quantity.milliliters !== null ||
        projected.quantity.unit !== null;
      if (hasQuantity) codes.push("quantity_present_unexpected");
      break;
    }
    case "unspecified": {
      // O valor não é comparado porque a superfície não o declarou, mas o item
      // proposto precisa **produzir** quantidade utilizável com unidade
      // explícita: "não comparar" não pode virar "não exigir" (§8.3).
      if (
        projected.quantity.value === null ||
        projected.quantity.unit === null
      ) {
        codes.push("quantity_unusable");
      }
      if (expected.quantity.unitMustNotBeConvertedToGrams) {
        if (
          projected.quantity.grams !== null ||
          projected.quantity.unitIsMass
        ) {
          codes.push("quantity_became_grams");
        }
      }
      break;
    }
  }

  // Classificação (§8.7, §9.3 classe J): presente e versionada em item
  // proposto, provisoriedade declarada e conteúdo comparado quando o caso mede.
  if (expected.nextAction === "propose") {
    if (!projected.classification.present) {
      codes.push("classification_missing");
    } else if (!projected.classification.versioned) {
      codes.push("classification_unversioned");
    }
  }
  if (
    projected.classification.provisional !==
    expected.classification.provisionalRequired
  ) {
    codes.push("classification_mismatch");
  }
  if (expected.classification.measured) {
    if (
      projected.classification.processingLevel !==
        expected.classification.processingLevel ||
      projected.classification.isFruit !== expected.classification.isFruit ||
      projected.classification.isVegetable !==
        expected.classification.isVegetable ||
      projected.classification.isUltraProcessed !==
        expected.classification.isUltraProcessed
    ) {
      codes.push("classification_mismatch");
    }
  }
  if (!sameSet(expected.unresolvedFields, projected.unresolvedFields)) {
    codes.push("unresolved_fields_mismatch");
  }

  for (const code of expected.reasonCodes) {
    if (!projected.reasonCodes.includes(code))
      codes.push("reason_code_missing");
  }
  for (const code of expected.forbiddenReasonCodes) {
    if (projected.reasonCodes.includes(code)) {
      codes.push("reason_code_forbidden");
    }
  }

  for (const field of expected.clarification.requiredFields) {
    if (!projected.unresolvedFields.includes(field)) {
      codes.push("clarification_mismatch");
    }
  }

  // Alternativas: a preservação é semântica (§4.1.8), não apenas cardinal.
  if (expected.ambiguity.mustPreserveAlternatives) {
    if (projected.alternativeCount < expected.ambiguity.minAlternatives) {
      codes.push("alternatives_lost");
    }
    const expectedKeys = expected.alternatives
      .map(alternativeKeyOfExpected)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const producedKeys = projected.alternatives
      .map(alternative =>
        [
          alternative.name,
          alternative.brand ?? "",
          alternative.variant ?? "",
          [...alternative.preparation].sort().join("|"),
          [...alternative.qualifierValues].sort().join("|"),
        ].join("::")
      )
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    if (
      expectedKeys.length !== producedKeys.length ||
      !expectedKeys.every((key, index) => key === producedKeys[index])
    ) {
      codes.push("alternatives_mismatch");
    }
  }

  const nutrition = expected.nutrition;
  if (nutrition.requirement === "absent") {
    // Item que não é proposto não carrega composição: ausência é obrigação,
    // não omissão tolerada (§9.2: ausência nunca vira zeros nem perfil).
    if (projected.nutrition.present) {
      codes.push("nutrition_present_unexpected");
    }
  } else {
    if (!projected.nutrition.present) codes.push("nutrition_missing");
    if (projected.nutrition.origins.length === 0) {
      codes.push("nutrition_provenance_missing");
    }
    for (const origin of nutrition.forbiddenOrigins) {
      if (projected.nutrition.origins.includes(origin)) {
        codes.push("nutrition_origin_forbidden");
      }
    }
    if (nutrition.allowedOrigins.length > 0) {
      for (const origin of projected.nutrition.origins) {
        if (!nutrition.allowedOrigins.includes(origin)) {
          codes.push("nutrition_origin_forbidden");
        }
      }
    }
    if (
      nutrition.requirement === "provisional_declared" &&
      !projected.nutrition.provisional
    ) {
      codes.push("provisional_declaration_missing");
    }
    if (nutrition.provisionalRequired && !projected.nutrition.provisional) {
      codes.push("provisional_declaration_missing");
    }
    if (
      nutrition.genericProfileMustNotBeVerified &&
      projected.nutrition.verified &&
      !projected.nutrition.verifiedBySpecificEvidence
    ) {
      codes.push("nutrition_generic_as_verified");
    }
  }

  return [...new Set(codes)];
}

function alternativeKeyOfExpected(
  alternative: ExpectedDecision["alternatives"][number]
): string {
  return [
    alternative.name,
    alternative.brand ?? "",
    alternative.variant ?? "",
    [...alternative.preparation].sort().join("|"),
    [...alternative.qualifiers].sort().join("|"),
  ].join("::");
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x.localeCompare(y, "pt-BR"));
  const right = [...b].sort((x, y) => x.localeCompare(y, "pt-BR"));
  return left.every((value, index) => value === right[index]);
}

function cloneDecision(
  decision: FoodResolutionDecision
): FoodResolutionDecision {
  return JSON.parse(JSON.stringify(decision)) as FoodResolutionDecision;
}

/**
 * Casa as decisões esperadas com as decisões produzidas por projeção semântica
 * com busca determinística (a ordem de retorno do resolvedor não é contrato).
 */
function matchDecisions(
  expected: readonly ExpectedDecision[],
  produced: readonly ProjectedDecision[]
): {
  unmatchedExpected: ExpectedDecision[];
  unmatchedProduced: ProjectedDecision[];
  codesByLabel: Map<string, CorpusFailureCode[]>;
} {
  const codesByLabel = new Map<string, CorpusFailureCode[]>();
  const used = new Set<number>();
  const unmatchedExpected: ExpectedDecision[] = [];

  for (const item of expected) {
    let bestCodes: CorpusFailureCode[] = [];
    for (let index = 0; index < produced.length; index += 1) {
      if (used.has(index)) continue;
      const codes = compareExpectedDecision(item, produced[index]);
      if (codes.length === 0) {
        used.add(index);
        bestCodes = [];
        break;
      }
      if (bestCodes.length === 0 || codes.length < bestCodes.length) {
        bestCodes = codes;
      }
    }

    if (bestCodes.length === 0) continue;
    unmatchedExpected.push(item);
    codesByLabel.set(item.label, bestCodes);
  }

  const unmatchedProduced = produced.filter((_, index) => !used.has(index));
  return { unmatchedExpected, unmatchedProduced, codesByLabel };
}

/**
 * Avalia o resultado de um caso contra a referência independente. Usado tanto
 * pelo corpus quanto pelos cenários de §16.1.
 */
function evaluateResult(
  entry: GoldenCorpusCase,
  result: CorpusResolverResult,
  recordedWrites: readonly string[],
  /**
   * `true` apenas na fase de aquisição de um cenário de §16.1: ali a escrita é
   * o efeito esperado, não uma violação.
   */
  writesAllowed = false
): {
  failures: CorpusFailure[];
  projections: ProjectedDecision[];
  operation: MealOperation | null;
  rawDecisions: FoodResolutionDecision[];
  abstained: boolean;
} {
  const failures: CorpusFailure[] = [];
  const projections: ProjectedDecision[] = [];
  const rawDecisions: FoodResolutionDecision[] = [];
  let operation: MealOperation | null = null;
  let abstained = false;

  // A evidência primária de efeito é o ledger da fachada de conhecimento; a
  // lista declarada pelo resolvedor é uma segunda fonte, para que uma escrita
  // que não passou pela fachada também seja falha (§16.1).
  const declared = [...(result.knowledgeWrites ?? [])];
  const writes = [...new Set([...recordedWrites, ...declared])];
  if (writes.length > 0 && !writesAllowed) {
    failures.push({
      caseId: entry.caseId,
      label: null,
      codes: ["learning_applied_during_measurement"],
      detail: `escrita de conhecimento durante a medição: ${writes.join(", ")}`,
    });
  }

  if (!Array.isArray(result.decisions) || result.decisions.length === 0) {
    failures.push({
      caseId: entry.caseId,
      label: null,
      codes: ["missing_decision"],
      detail: "resolvedor não retornou nenhuma decisão",
    });
    abstained = true;
  }

  for (const raw of result.decisions ?? []) {
    const validation = foodResolutionDecisionSchema.safeParse(raw);
    if (!validation.success) {
      failures.push({
        caseId: entry.caseId,
        label: null,
        codes: ["decision_invalid"],
        detail: `decisão inválida: ${validation.error.issues
          .map(issue => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      });
      abstained = true;
      continue;
    }
    const decision = validation.data;
    rawDecisions.push(cloneDecision(decision));
    projections.push(projectDecision(decision));
  }

  // A operação de refeição faz parte do contrato público (§9.2) e é validada
  // contra o schema canônico, que é estrito: campo não governado reprova.
  if (result.operation !== undefined && result.operation !== null) {
    const validation = foodMealOperationSchema.safeParse(result.operation);
    if (!validation.success) {
      failures.push({
        caseId: entry.caseId,
        label: null,
        codes: ["operation_invalid"],
        detail: `operação inválida: ${validation.error.issues
          .map(issue => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      });
    } else {
      operation = validation.data;
    }
  }

  const { unmatchedExpected, unmatchedProduced, codesByLabel } = matchDecisions(
    entry.expected.decisions,
    projections
  );

  for (const item of unmatchedExpected) {
    failures.push({
      caseId: entry.caseId,
      label: item.label,
      codes: codesByLabel.get(item.label) ?? ["missing_decision"],
      detail: `decisão esperada '${item.label}' não correspondeu a nenhuma decisão produzida`,
    });
  }

  for (const produced of unmatchedProduced) {
    failures.push({
      caseId: entry.caseId,
      label: null,
      codes: ["unexpected_decision"],
      detail:
        `decisão produzida não esperada: ${produced.identity.canonicalName ?? "(sem identidade)"} / ${produced.quantity.value ?? "?"} ${produced.quantity.unit ?? ""}`.trim(),
    });
  }

  {
    // A operação esperada é obrigatória no schema: ela **sempre** é comparada.
    // Deixar a comparação condicional permitiria operação materialmente errada
    // passar sem que nada fosse verificado (§7.1, §9.2).
    if (!operation) {
      failures.push({
        caseId: entry.caseId,
        label: null,
        codes: ["operation_missing"],
        detail: "operação esperada não foi resolvida",
      });
    } else if (
      operation.action !== entry.expected.operation.action ||
      operation.targetMeal !== entry.expected.operation.targetMeal ||
      operation.date !== entry.expected.operation.date
    ) {
      failures.push({
        caseId: entry.caseId,
        label: null,
        codes: ["operation_mismatch"],
        detail: `operação ${operation.action}/${operation.targetMeal}/${operation.date} divergente do esperado`,
      });
    }
  }

  if (entry.expected.mustExplainExclusions) {
    for (const produced of projections) {
      if (
        produced.nextAction !== "propose" &&
        produced.reasonCodes.length === 0
      ) {
        failures.push({
          caseId: entry.caseId,
          label: null,
          codes: ["exclusion_not_explained"],
          detail: "item não resolvido sem código de motivo estruturado (§7.2)",
        });
      }
    }
  }

  return { failures, projections, operation, rawDecisions, abstained };
}

/**
 * Armazenamento de conhecimento instrumentado. Ele vive por execução (ou por
 * cenário) e é a **única** porta de acesso: um resolvedor não recebe outro
 * handle. Fora do modo `acquisition`, `write` registra a tentativa e falha,
 * de modo que o isolamento do holdout é uma capacidade e não uma convenção
 * (§16.1).
 */
export interface CorpusKnowledgeStore {
  gateFor(
    caseId: string,
    split: CorpusSplit,
    mode: "read_only" | "acquisition"
  ): CorpusKnowledgeGate;
  /** Revoga uma chave (§16.1: revogação sem reaplicação por cache obsoleto). */
  revoke(key: string): void;
  readonly ledger: CorpusKnowledgeLedgerEntry[];
}

/** Cria um armazenamento de conhecimento instrumentado e isolado. */
export function createKnowledgeStore(): CorpusKnowledgeStore {
  const entries = new Map<string, string>();
  const ledger: CorpusKnowledgeLedgerEntry[] = [];

  return {
    ledger,
    revoke(key: string) {
      entries.delete(key);
    },
    gateFor(caseId, split, mode) {
      const gate: CorpusKnowledgeGate = {
        mode,
        async read(key: string) {
          const value = entries.get(key) ?? null;
          ledger.push({
            caseId,
            split,
            operation: "read",
            key,
            hit: value !== null,
          });
          return value;
        },
        async write(key: string, value: string) {
          ledger.push({ caseId, split, operation: "write_attempt", key });
          if (mode !== "acquisition") {
            throw new Error(
              `escrita de conhecimento bloqueada em ${caseId} (§16.1: holdout não alimenta memória)`
            );
          }
          entries.set(key, value);
        },
      };
      return gate;
    },
  };
}

function withinTolerance(
  a: number | null,
  b: number | null,
  tolerance: number | null
): boolean {
  if (a === null || b === null) return a === b;
  if (a === b) return true;
  if (tolerance === null) return false;
  return Math.abs(a - b) <= tolerance;
}

function extractMacros(
  decision: FoodResolutionDecision
): { key: string; value: number | null }[] {
  const consumed = decision.nutrition.consumed;
  return [
    { key: "calories", value: consumed?.calories ?? null },
    { key: "protein", value: consumed?.protein ?? null },
    { key: "carbs", value: consumed?.carbs ?? null },
    { key: "fat", value: consumed?.fat ?? null },
    { key: "fiber", value: consumed?.fiber ?? null },
    { key: "sugar", value: consumed?.sugar ?? null },
    { key: "sodiumMg", value: consumed?.sodiumMg ?? null },
    { key: "grams", value: decision.quantity.grams },
    { key: "milliliters", value: decision.quantity.milliliters },
  ];
}

function buildSegment(
  dimension: CorpusSegmentDimension,
  segment: string,
  outcomes: readonly CaseOutcome[]
): CorpusSegmentMetrics {
  const cases = outcomes.length;
  const resolvableLabeled = outcomes.filter(
    outcome => outcome.case.decisionClass === "resolvable"
  ).length;
  const clarificationLabeled = outcomes.filter(
    outcome => outcome.case.decisionClass === "clarification"
  ).length;
  const rejectionLabeled = outcomes.filter(
    outcome => outcome.case.decisionClass === "rejection"
  ).length;
  const deferredLabeled = outcomes.filter(
    outcome => outcome.case.decisionClass === "deferred"
  ).length;
  const matchedCases = outcomes.filter(outcome => outcome.matched).length;
  // A meta de §1.1 compara acertos com os casos rotulados como resolvíveis;
  // casos de clarificação/rejeição/diferidos são verificados separadamente e
  // não inflam o numerador.
  const matchedResolvable = outcomes.filter(
    outcome => outcome.matched && outcome.case.decisionClass === "resolvable"
  ).length;
  const abstentions = outcomes.filter(outcome => outcome.abstained).length;
  const families = outcomes
    .map(outcome => familyCounters(outcome.failures))
    .reduce(addFamilies, emptyFamilies());

  const latencies = outcomes
    .map(outcome => outcome.latencyMs)
    .filter((value): value is number => value !== null);
  const costs = outcomes
    .map(outcome => outcome.costUsd)
    .filter((value): value is number => value !== null);

  return {
    dimension,
    segment,
    cases,
    resolvableLabeled,
    clarificationLabeled,
    rejectionLabeled,
    deferredLabeled,
    matchedCases,
    failedCases: cases - matchedCases,
    abstentions,
    matchRate:
      resolvableLabeled === 0 ? null : matchedResolvable / resolvableLabeled,
    decisionMatchRate: cases === 0 ? null : matchedCases / cases,
    sampleStatus: resolvableLabeled === 0 ? "missing" : "present",
    families,
    totalLatencyMs:
      latencies.length === 0
        ? null
        : latencies.reduce((sum, value) => sum + value, 0),
    latencySamples: latencies.length,
    totalCostUsd:
      costs.length === 0 ? null : costs.reduce((sum, value) => sum + value, 0),
    costSamples: costs.length,
  };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string[]) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    for (const k of key(item)) {
      const list = map.get(k) ?? [];
      list.push(item);
      map.set(k, list);
    }
  }
  return map;
}

function segmentList(
  dimension: CorpusSegmentDimension,
  outcomes: readonly CaseOutcome[],
  keyOf: (entry: GoldenCorpusCase) => string[]
): CorpusSegmentMetrics[] {
  return [...groupBy(outcomes, outcome => keyOf(outcome.case))]
    .map(([segment, list]) => buildSegment(dimension, segment, list))
    .sort((a, b) => a.segment.localeCompare(b.segment, "pt-BR"));
}

/** Executa o corpus contra o resolvedor sob teste e produz o relatório. */
export async function runCorpus(
  corpus: GoldenCorpus,
  resolver: CorpusResolverUnderTest,
  options: Partial<CorpusRunOptions> = {}
): Promise<CorpusReport> {
  const resolvedOptions: CorpusRunOptions = {
    ...DEFAULT_CORPUS_RUN_OPTIONS,
    ...options,
  };

  const parsed = goldenCorpusSchema.parse(corpus);
  const integrity = inspectCorpusIntegrity(parsed);

  const outcomes: CaseOutcome[] = [];
  const holdoutKnowledgeWrites: { caseId: string; writes: string[] }[] = [];
  // Um armazenamento por execução: durante a medição de casos isolados o modo
  // é sempre `read_only`, então nenhuma escrita é aceita (§16.1).
  const knowledge = createKnowledgeStore();
  let resolveCalls = 0;

  for (const entry of parsed.cases) {
    resolveCalls += 1;
    const ledgerStart = knowledge.ledger.length;
    const gate = knowledge.gateFor(entry.caseId, entry.split, "read_only");
    let result: CorpusResolverResult;
    try {
      result = await resolver.resolve({
        case: toCorpusCaseInput(entry),
        allowLearning: false,
        knowledge: gate,
      });
    } catch (error) {
      outcomes.push({
        case: entry,
        matched: false,
        abstained: true,
        failures: [
          {
            caseId: entry.caseId,
            label: null,
            codes: ["resolver_error"],
            detail:
              error instanceof Error
                ? `resolvedor lançou: ${error.message}`
                : "resolvedor lançou erro não identificado",
          },
        ],
        projections: [],
        operation: null,
        rawDecisions: [],
        latencyMs: null,
        costUsd: null,
      });
      continue;
    }

    const recordedWrites = knowledge.ledger
      .slice(ledgerStart)
      .filter(item => item.operation === "write_attempt")
      .map(item => item.key);
    if (recordedWrites.length > 0 && entry.split === "holdout") {
      holdoutKnowledgeWrites.push({
        caseId: entry.caseId,
        writes: recordedWrites,
      });
    }

    const evaluated = evaluateResult(entry, result, recordedWrites);
    // Métricas são evidência de custo e latência (§16.2): amostra não finita ou
    // negativa é falha declarada, nunca valor silenciosamente agregado.
    const metricFailure = validateMetrics(entry.caseId, result.metrics);
    if (metricFailure) evaluated.failures.push(metricFailure);

    outcomes.push({
      case: entry,
      matched: evaluated.failures.length === 0,
      abstained: evaluated.abstained,
      failures: evaluated.failures,
      projections: evaluated.projections,
      operation: evaluated.operation,
      rawDecisions: evaluated.rawDecisions,
      latencyMs:
        metricFailure ||
        typeof result.metrics !== "object" ||
        result.metrics === null
          ? null
          : (result.metrics.latencyMs ?? null),
      costUsd:
        metricFailure ||
        typeof result.metrics !== "object" ||
        result.metrics === null
          ? null
          : (result.metrics.costUsd ?? null),
    });
  }

  integrity.holdoutKnowledgeWrites = holdoutKnowledgeWrites;
  if (holdoutKnowledgeWrites.length > 0) integrity.status = "invalid";

  const failures = outcomes.flatMap(outcome => outcome.failures);

  const byModality = segmentList("modality", outcomes, entry => [
    entry.modality,
  ]);
  const byDecisionClass = segmentList("decisionClass", outcomes, entry => [
    entry.decisionClass,
  ]);
  const bySplit = segmentList("split", outcomes, entry => [entry.split]);
  const byNonRecurrenceClass = segmentList(
    "nonRecurrenceClass",
    outcomes,
    entry => [...entry.nonRecurrenceClasses]
  );
  const byBrand = segmentList("brand", outcomes, entry => [
    segmentKeysOf(entry).brand,
  ]);
  const byMaterialAttribute = segmentList(
    "materialAttribute",
    outcomes,
    entry => [segmentKeysOf(entry).materialAttribute]
  );
  const byMeasure = segmentList("measure", outcomes, entry => [
    segmentKeysOf(entry).measure,
  ]);
  const byContinuity = segmentList("continuity", outcomes, entry => [
    entry.continuity,
  ]);
  const byOperation = segmentList("operation", outcomes, entry => [
    segmentKeysOf(entry).operation,
  ]);
  const byNutritionSource = segmentList("nutritionSource", outcomes, entry => [
    segmentKeysOf(entry).nutritionSource,
  ]);

  const overall = buildSegment("modality", "corpus", outcomes);

  const outcomeByCaseId = new Map(
    outcomes.map(outcome => [outcome.case.caseId, outcome])
  );

  const metamorphic = buildMetamorphicResults(parsed, outcomeByCaseId);
  const negativeControls = buildNegativeControlEvidence(
    parsed,
    outcomeByCaseId,
    resolvedOptions.revisions
  );
  const macroConsistency = buildMacroConsistency(
    parsed,
    outcomeByCaseId,
    CORPUS_ROUNDING_TOLERANCE
  );
  const learningScenarios = await runLearningScenarios(
    parsed,
    resolver,
    integrity
  );

  const wrongConvergence = metamorphic.filter(item => item.wrongConvergence);
  const convergedControls = negativeControls.filter(
    item => !item.discriminating
  );
  const scenarioFailures = learningScenarios.filter(item => !item.passed);

  const blockReasons: CorpusGateBlockReason[] = [];
  if (integrity.status === "invalid") {
    if (
      integrity.duplicateCaseIds.length > 0 ||
      integrity.duplicateSurfaces.length > 0
    ) {
      blockReasons.push("duplicate_cases");
    }
    if (integrity.splitLeakage.length > 0) blockReasons.push("split_leakage");
    if (integrity.holdoutKnowledgeWrites.length > 0) {
      blockReasons.push("holdout_knowledge_write");
    }
    if (
      integrity.invalidCases.length > 0 ||
      integrity.invalidGroups.length > 0 ||
      integrity.negativeControlConflicts.length > 0 ||
      integrity.divergentGroupExpectations.length > 0 ||
      integrity.invalidScenarios.length > 0
    ) {
      blockReasons.push("corpus_invalid");
    }
    // Equivalência sem referência declarada é uma causa própria de bloqueio:
    // sem referência independente não existe verificação de §4.1.8.
    if (integrity.undeclaredEquivalence.length > 0) {
      blockReasons.push("undeclared_equivalence");
    }
  }
  if (wrongConvergence.length > 0 || convergedControls.length > 0) {
    blockReasons.push("negative_control_convergence");
  }
  // Divergência de macros entre entradas equivalentes bloqueia **sempre**:
  // a tolerância é `OPEN` (§25 item 30) e não existe valor aprovado.
  if (macroConsistency.some(item => !item.consistent)) {
    blockReasons.push("rounding_tolerance_not_calibrated");
  }
  if (
    CORPUS_REVISION_KEYS.some(key =>
      isUnpinnedRevision(resolvedOptions.revisions[key])
    )
  ) {
    blockReasons.push("revisions_not_pinned");
  }
  if (scenarioFailures.length > 0) {
    blockReasons.push("scenario_invariant_violated");
  }
  if (
    learningScenarios.some(scenario =>
      scenario.steps.some(
        step => step.phase === "acquisition" && step.recordedWriteAttempts === 0
      )
    )
  ) {
    blockReasons.push("scenario_invariant_violated");
  }

  const nonResolvableFailureCount = outcomes.filter(
    outcome => !outcome.matched && outcome.case.decisionClass !== "resolvable"
  ).length;

  const gate = buildGate(
    overall,
    failures.length,
    nonResolvableFailureCount,
    blockReasons
  );

  const report: CorpusReport = {
    corpusVersion: parsed.corpusVersion,
    corpusSchemaVersion: parsed.schemaVersion,
    resolver: { id: resolver.id, revision: resolver.revision },
    revisions: resolvedOptions.revisions,
    caseCount: parsed.cases.length,
    resolveCalls,
    integrity,
    overall,
    byModality,
    byDecisionClass,
    bySplit,
    byNonRecurrenceClass,
    byBrand,
    byMaterialAttribute,
    byMeasure,
    byContinuity,
    byOperation,
    byNutritionSource,
    failures,
    metamorphic,
    negativeControls,
    macroConsistency,
    learningScenarios,
    gate,
  };

  // O relatório é evidência de aceite (§16.2): uma vez produzido, não pode ser
  // mutado por quem o consome. Um consumidor capaz de trocar `status` para
  // `passed` depois da execução tornaria o gate decorativo.
  return deepFreeze(report);
}

/**
 * Congela recursivamente o relatório. Estruturas são convertidas em cópias
 * congeladas para que nenhuma referência compartilhada permaneça mutável.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

/** Executa o corpus canônico versionado. */
export async function runGoldenFoodCorpus(
  resolver: CorpusResolverUnderTest,
  options: Partial<CorpusRunOptions> = {}
): Promise<CorpusReport> {
  return runCorpus(goldenFoodCorpus, resolver, options);
}

/**
 * Executa os cenários de §16.1 com passos ordenados contra a **mesma**
 * instância do resolvedor, de modo que persistência, isolamento, precedência e
 * revogação sejam efeitos observáveis e não rótulos de caso.
 */
export async function runLearningScenarios(
  corpus: GoldenCorpus,
  resolver: CorpusResolverUnderTest,
  integrity: CorpusIntegrityReport
): Promise<LearningScenarioResult[]> {
  const byCaseId = new Map(corpus.cases.map(entry => [entry.caseId, entry]));
  const results: LearningScenarioResult[] = [];

  for (const scenario of corpus.learningScenarios) {
    const stepResults: LearningScenarioStepResult[] = [];
    const projectionsByStep = new Map<string, ProjectedDecision[]>();
    const scenarioFailures: CorpusFailure[] = [];
    const ownerRefs = new Set<string>();
    const conversationRefs = new Set<string>();
    // O armazenamento vive por cenário: é o que torna persistência após
    // reinício e revogação efeitos observáveis, e não rótulos de caso.
    const knowledge = createKnowledgeStore();
    // Cadeia causal: chaves escritas na aquisição e chaves adquiridas que foram
    // efetivamente encontradas em leituras posteriores. Sem essa cadeia, o
    // cenário não prova aprendizado — prova apenas rótulos por caseId.
    const acquiredKeys = new Set<string>();
    const consultedAcquiredKeys = new Set<string>();

    for (const step of scenario.steps) {
      const entry = byCaseId.get(step.caseId);
      const causalFailures: CorpusFailure[] = [];
      if (!entry) {
        stepResults.push({
          stepId: step.stepId,
          phase: step.phase,
          caseId: step.caseId,
          allowLearning: step.writesAllowed,
          writesAllowed: step.writesAllowed,
          matched: false,
          recordedWriteAttempts: 0,
          sameResultAsStepId: step.sameResultAsStepId,
          sameResultSatisfied: null,
          differentFromStepId: step.differentFromStepId,
          differentFromSatisfied: null,
          failures: [
            {
              caseId: step.caseId,
              label: null,
              codes: ["scenario_step_mismatch"],
              detail: `passo ${step.stepId} aponta para caso inexistente`,
            },
          ],
        });
        continue;
      }

      ownerRefs.add(entry.scenario.ownerRef);
      conversationRefs.add(entry.scenario.conversationRef);

      for (const key of step.revokeKeys) knowledge.revoke(key);

      const ledgerStart = knowledge.ledger.length;
      const gate = knowledge.gateFor(
        entry.caseId,
        entry.split,
        step.writesAllowed ? "acquisition" : "read_only"
      );

      let evaluated: ReturnType<typeof evaluateResult>;
      let recordedWriteAttempts = 0;
      try {
        const result = await resolver.resolve({
          case: toCorpusCaseInput(entry),
          allowLearning: step.writesAllowed,
          knowledge: gate,
        });
        const stepLedger = knowledge.ledger.slice(ledgerStart);
        const recorded = stepLedger
          .filter(item => item.operation === "write_attempt")
          .map(item => item.key);
        const reads = stepLedger.filter(item => item.operation === "read");
        recordedWriteAttempts = recorded.length;
        for (const key of recorded) {
          if (step.phase === "acquisition") acquiredKeys.add(key);
        }
        for (const key of step.requiredKnowledgeWrites) {
          if (!recorded.includes(key)) {
            causalFailures.push({
              caseId: entry.caseId,
              label: null,
              codes: ["scenario_effect_missing"],
              detail: `passo ${step.stepId} deveria escrever a chave de conhecimento '${key}'`,
            });
          }
        }
        for (const key of step.requiredKnowledgeReads) {
          const read = reads.find(item => item.key === key);
          if (!read) {
            causalFailures.push({
              caseId: entry.caseId,
              label: null,
              codes: ["scenario_effect_missing"],
              detail: `passo ${step.stepId} deveria consultar a chave de conhecimento '${key}'`,
            });
            continue;
          }
          // Depois da revogação, a leitura precisa **não** encontrar o valor:
          // é o que prova que a revogação foi aplicada, não apenas declarada.
          if (step.revokeKeys.includes(key) && read.hit === true) {
            causalFailures.push({
              caseId: entry.caseId,
              label: null,
              codes: ["scenario_effect_missing"],
              detail: `passo ${step.stepId} leu a chave revogada '${key}' e ainda encontrou valor`,
            });
          }
          if (
            step.phase !== "revocation" &&
            step.requiredKnowledgeWrites.length === 0 &&
            acquiredKeys.size > 0 &&
            acquiredKeys.has(key) &&
            read.hit !== true
          ) {
            causalFailures.push({
              caseId: entry.caseId,
              label: null,
              codes: ["scenario_effect_missing"],
              detail: `passo ${step.stepId} não encontrou o conhecimento adquirido na chave '${key}'`,
            });
          }
        }
        for (const read of reads) {
          if (acquiredKeys.has(read.key) && read.hit === true) {
            consultedAcquiredKeys.add(read.key);
          }
        }
        if (recorded.length > 0 && !step.writesAllowed) {
          integrity.status = "invalid";
          integrity.holdoutKnowledgeWrites.push({
            caseId: entry.caseId,
            writes: recorded,
          });
        }
        evaluated = evaluateResult(entry, result, recorded, step.writesAllowed);
      } catch (error) {
        evaluated = {
          failures: [
            {
              caseId: entry.caseId,
              label: null,
              codes: ["resolver_error"],
              detail:
                error instanceof Error
                  ? `cenário ${scenario.scenarioId}, passo ${step.stepId}: ${error.message}`
                  : `cenário ${scenario.scenarioId}, passo ${step.stepId}: erro não identificado`,
            },
          ],
          projections: [],
          operation: null,
          rawDecisions: [],
          abstained: true,
        };
      }

      const failures = [...evaluated.failures];
      failures.push(...causalFailures);
      const previous = step.sameResultAsStepId
        ? projectionsByStep.get(step.sameResultAsStepId)
        : undefined;
      const different = step.differentFromStepId
        ? projectionsByStep.get(step.differentFromStepId)
        : undefined;

      const sameResultSatisfied = step.sameResultAsStepId
        ? previous !== undefined &&
          projectionMultisetEqual(evaluated.projections, previous)
        : null;
      const differentFromSatisfied = step.differentFromStepId
        ? different !== undefined &&
          !projectionMultisetEqual(evaluated.projections, different)
        : null;

      if (sameResultSatisfied === false) {
        failures.push({
          caseId: entry.caseId,
          label: null,
          codes: ["scenario_invariant_violated"],
          detail: `passo ${step.stepId} deveria reproduzir o resultado de ${step.sameResultAsStepId} (persistência/idempotência)`,
        });
      }
      if (differentFromSatisfied === false) {
        failures.push({
          caseId: entry.caseId,
          label: null,
          codes: ["scenario_invariant_violated"],
          detail: `passo ${step.stepId} não pode reproduzir o resultado de ${step.differentFromStepId} (isolamento/revogação)`,
        });
      }
      if (!step.writesAllowed && recordedWriteAttempts > 0) {
        failures.push({
          caseId: entry.caseId,
          label: null,
          codes: ["learning_applied_during_measurement"],
          detail: `passo ${step.stepId} tentou escrever conhecimento fora da fase de aquisição`,
        });
      }
      // Aquisição é prova de aprendizado: sem escrita observável, o passo é
      // rótulo, não efeito (§16.1).
      if (step.phase === "acquisition" && recordedWriteAttempts === 0) {
        failures.push({
          caseId: entry.caseId,
          label: null,
          codes: ["scenario_effect_missing"],
          detail: `passo ${step.stepId} (aquisição) não registrou nenhuma escrita de conhecimento`,
        });
      }

      projectionsByStep.set(step.stepId, evaluated.projections);
      const stepResult: LearningScenarioStepResult = {
        stepId: step.stepId,
        phase: step.phase,
        caseId: step.caseId,
        allowLearning: step.writesAllowed,
        writesAllowed: step.writesAllowed,
        matched:
          evaluated.failures.filter(
            failure =>
              !failure.codes.includes("learning_applied_during_measurement")
          ).length === 0,
        recordedWriteAttempts,
        sameResultAsStepId: step.sameResultAsStepId,
        sameResultSatisfied,
        differentFromStepId: step.differentFromStepId,
        differentFromSatisfied,
        failures,
      };
      stepResults.push(stepResult);
      scenarioFailures.push(...failures);
    }
    // Fechamento da cadeia causal: o conhecimento escrito na aquisição precisa
    // ter sido encontrado em leitura posterior.
    if (acquiredKeys.size > 0 && consultedAcquiredKeys.size === 0) {
      scenarioFailures.push({
        caseId:
          scenario.steps.find(step => step.phase === "acquisition")?.caseId ??
          scenario.steps[0].caseId,
        label: null,
        codes: ["scenario_effect_missing"],
        detail:
          "cenário não prova aprendizado: nenhuma chave escrita na aquisição foi encontrada em leitura posterior",
      });
    }

    results.push({
      scenarioId: scenario.scenarioId,
      ownerRefs: [...ownerRefs].sort(),
      conversationRefs: [...conversationRefs].sort(),
      phases: [...new Set(scenario.steps.map(step => step.phase))].sort(),
      steps: stepResults,
      passed: scenarioFailures.length === 0,
      failures: scenarioFailures,
    });
  }

  return results.sort((a, b) =>
    a.scenarioId.localeCompare(b.scenarioId, "pt-BR")
  );
}

function buildGate(
  overall: CorpusSegmentMetrics,
  failureCount: number,
  nonResolvableFailureCount: number,
  blockReasons: readonly CorpusGateBlockReason[]
): CorpusGate {
  // A meta de §1.1 é fixa. Ela não é parâmetro de execução: aceitar um valor
  // menor transformaria o gate em carimbo, permitindo aprovar um resolvedor
  // abaixo da meta acordada.
  const minMatchRate = GOLDEN_CORPUS_MIN_MATCH_RATE;
  const base = {
    minMatchRate,
    matchRate: overall.matchRate,
    failureCount,
    nonResolvableFailureCount,
    blockReasons: [...blockReasons],
  };

  if (blockReasons.length > 0) {
    return { ...base, status: "blocked" };
  }
  if (overall.resolvableLabeled === 0) {
    return { ...base, status: "sample_missing" };
  }
  // Falhas fora dos casos resolvíveis não são cobertas pela meta de §1.1:
  // clarificação e rejeição esperadas precisam estar corretas integralmente.
  if (nonResolvableFailureCount > 0) {
    return { ...base, status: "failed" };
  }
  if (overall.matchRate === null || overall.matchRate < minMatchRate) {
    return { ...base, status: "failed" };
  }
  return { ...base, status: "passed" };
}

function buildMetamorphicResults(
  corpus: GoldenCorpus,
  outcomeByCaseId: ReadonlyMap<string, CaseOutcome>
): MetamorphicGroupResult[] {
  const groups = new Map<string, GoldenCorpusCase[]>();
  for (const entry of corpus.cases) {
    if (!entry.metamorphicGroup) continue;
    const list = groups.get(entry.metamorphicGroup) ?? [];
    list.push(entry);
    groups.set(entry.metamorphicGroup, list);
  }

  const results: MetamorphicGroupResult[] = [];
  for (const [groupId, entries] of groups) {
    const caseOutcomes = entries
      .map(entry => outcomeByCaseId.get(entry.caseId))
      .filter((outcome): outcome is CaseOutcome => Boolean(outcome));

    const allMatchReference = caseOutcomes.every(outcome => outcome.matched);
    const referenceProjection = caseOutcomes[0]?.projections ?? [];
    const converged = caseOutcomes.every(outcome =>
      projectionMultisetEqual(outcome.projections, referenceProjection)
    );

    results.push({
      groupId,
      memberCaseIds: entries.map(entry => entry.caseId).sort(),
      splits: [...new Set(entries.map(entry => entry.split))].sort(),
      allMatchReference,
      converged,
      wrongConvergence: converged && !allMatchReference,
      failures: caseOutcomes.flatMap(outcome => outcome.failures),
    });
  }

  return results.sort((a, b) => a.groupId.localeCompare(b.groupId, "pt-BR"));
}

function projectionSignature(
  projections: readonly ProjectedDecision[]
): string {
  return projections
    .map(decision =>
      [
        decision.status,
        decision.nextAction,
        decision.identity.canonicalName ?? "",
        decision.identity.brand ?? "",
        decision.identity.variant ?? "",
        [...decision.identity.preparation].sort().join("|"),
        [...decision.identity.qualifierValues].sort().join("|"),
        String(decision.quantity.value ?? ""),
        decision.quantity.unit ?? "",
      ].join("::")
    )
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .join(" || ");
}

const DISCRIMINATING_DIMENSIONS: {
  dimension: string;
  value: (decision: ProjectedDecision) => string;
}[] = [
  { dimension: "status", value: decision => decision.status },
  { dimension: "nextAction", value: decision => decision.nextAction },
  {
    dimension: "identity",
    value: decision => decision.identity.canonicalName ?? "",
  },
  { dimension: "brand", value: decision => decision.identity.brand ?? "" },
  { dimension: "variant", value: decision => decision.identity.variant ?? "" },
  {
    dimension: "materialAttribute",
    value: decision => materialAttributeKey(decision.identity),
  },
  {
    dimension: "quantity",
    value: decision =>
      `${String(decision.quantity.value ?? "")} ${decision.quantity.unit ?? ""}`,
  },
  {
    dimension: "measure",
    value: decision => decision.quantity.measureKind ?? "",
  },
  {
    dimension: "unresolvedFields",
    value: decision => [...decision.unresolvedFields].sort().join("|"),
  },
  {
    dimension: "reasonCodes",
    value: decision => [...decision.reasonCodes].sort().join("|"),
  },
];

function discriminatingDimensionOf(
  control: readonly ProjectedDecision[],
  target: readonly ProjectedDecision[]
): string {
  if (control.length !== target.length) return "multiplicity";
  for (let index = 0; index < control.length; index += 1) {
    for (const candidate of DISCRIMINATING_DIMENSIONS) {
      if (candidate.value(control[index]) !== candidate.value(target[index])) {
        return candidate.dimension;
      }
    }
  }
  return "none";
}

function buildNegativeControlEvidence(
  corpus: GoldenCorpus,
  outcomeByCaseId: ReadonlyMap<string, CaseOutcome>,
  revisions: CorpusRevisions
): NegativeControlEvidence[] {
  const results: NegativeControlEvidence[] = [];
  for (const entry of corpus.cases) {
    if (!entry.negativeControlOf) continue;
    const control = outcomeByCaseId.get(entry.caseId);
    const target = outcomeByCaseId.get(entry.negativeControlOf);
    if (!control || !target) continue;
    // Um controle que absteve dos dois lados não discrimina nada: ausência de
    // saída não é evidência de distinção. `projectionMultisetEqual` devolve
    // `false` para listas vazias, e ler isso como discriminação produziria
    // evidência positiva a partir de nada.
    const executed =
      control.projections.length > 0 && target.projections.length > 0;
    const converged = projectionMultisetEqual(
      control.projections,
      target.projections
    );
    results.push({
      caseId: entry.caseId,
      targetCaseId: entry.negativeControlOf,
      hypothesis: entry.negativeControlHypothesis ?? "(não declarada)",
      executed,
      discriminating: executed && !converged,
      discriminatingDimension: !executed
        ? "not_executed"
        : converged
          ? "none"
          : discriminatingDimensionOf(control.projections, target.projections),
      controlSignature: projectionSignature(control.projections),
      targetSignature: projectionSignature(target.projections),
      revisions,
    });
  }
  return results.sort((a, b) => a.caseId.localeCompare(b.caseId, "pt-BR"));
}

function buildMacroConsistency(
  corpus: GoldenCorpus,
  outcomeByCaseId: ReadonlyMap<string, CaseOutcome>,
  tolerance: number | null
): MacroConsistencyResult[] {
  const groups = new Map<string, GoldenCorpusCase[]>();
  for (const entry of corpus.cases) {
    if (!entry.metamorphicGroup) continue;
    const list = groups.get(entry.metamorphicGroup) ?? [];
    list.push(entry);
    groups.set(entry.metamorphicGroup, list);
  }

  const results: MacroConsistencyResult[] = [];
  for (const [groupId, entries] of groups) {
    const decisions = entries.flatMap(
      entry => outcomeByCaseId.get(entry.caseId)?.rawDecisions ?? []
    );
    if (decisions.length < 2) {
      results.push({ groupId, consistent: true, divergences: [] });
      continue;
    }

    const baseline = extractMacros(decisions[0]);
    const divergences: string[] = [];
    for (const decision of decisions.slice(1)) {
      const current = extractMacros(decision);
      for (let index = 0; index < baseline.length; index += 1) {
        const a = baseline[index];
        const b = current[index];
        if (!withinTolerance(a.value, b.value, tolerance)) {
          divergences.push(`${a.key}: ${String(a.value)} ≠ ${String(b.value)}`);
        }
      }
    }
    results.push({
      groupId,
      consistent: divergences.length === 0,
      divergences: [...new Set(divergences)].sort(),
    });
  }

  return results.sort((a, b) => a.groupId.localeCompare(b.groupId, "pt-BR"));
}

/** Invariantes de revisão do relatório (§16.1: registrar cada revisão). */
export function reportRevisions(report: CorpusReport): CorpusRevisions {
  const revisions: Partial<CorpusRevisions> = {};
  for (const key of CORPUS_REVISION_KEYS) {
    revisions[key] = report.revisions[key];
  }
  return revisions as CorpusRevisions;
}

/** Tipo reexportado para uso dos testes e do relatório. */
export type { CorpusCaseInput };
