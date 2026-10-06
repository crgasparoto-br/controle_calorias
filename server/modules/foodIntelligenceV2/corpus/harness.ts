/**
 * Harness do Golden Food Corpus (issue #1299).
 *
 * Fonte canônica: `docs/design-docs/adr-food-intelligence-resolver-v2.md`
 * §1.1, §4.1.8, §8.12, §16, §16.1, §16.2, §17 e §18.
 *
 * O harness:
 * - entrega cada caso ao resolvedor sob teste e recebe a decisão dele; nunca
 *   fabrica a decisão final (§18);
 * - compara a projeção semântica (§4.1.8) com o resultado esperado declarado
 *   de forma independente;
 * - calcula a meta de §1.1 sobre todos os casos rotulados como resolvíveis,
 *   inclusive abstenções e falhas, e trata denominador zero como amostra
 *   ausente, nunca como zero;
 * - produz relatório por modalidade, classe de decisão, partição e classe de
 *   não-recorrência (§9.3, §16.2), não apenas média global;
 * - verifica equivalência de superfície e controles negativos contra a
 *   referência independente, e reprova quando duas entradas convergem para o
 *   mesmo resultado errado (§4.1.8);
 * - não aprova threshold numérico: a tolerância de arredondamento de macros é
 *   `OPEN` (§25 item 30) e sua ausência bloqueia em vez de ser preenchida.
 */
import {
  CORPUS_REVISION_KEYS,
  GOLDEN_CORPUS_MIN_MATCH_RATE,
  GOLDEN_CORPUS_SCHEMA_VERSION,
  CORPUS_DECLARED_REVISIONS,
  goldenCorpusSchema,
  type CorpusFailureCode,
  type CorpusGateBlockReason,
  type CorpusGateStatus,
  type CorpusRevisions,
  type CorpusResolverUnderTest,
  type CorpusSegmentDimension,
  type CorpusSplit,
  type ExpectedDecision,
  type GoldenCorpus,
  type GoldenCorpusCase,
  type CorpusDecisionClass,
  type CorpusNonRecurrenceClass,
} from "./contracts";
import { goldenFoodCorpus } from "./data";
import {
  decisionsSemanticallyEqual,
  projectDecision,
  type ProjectedDecision,
} from "./projection";
import {
  foodResolutionDecisionSchema,
  type FoodResolutionDecision,
  type MealOperation,
} from "../schemas";

/** Opções de execução da medição. */
export interface CorpusRunOptions {
  /**
   * Tolerância de arredondamento de macros entre entradas equivalentes (§1.1).
   * `null` significa não calibrada: divergência bloqueia em vez de ser
   * silenciosamente aceita (§25 item 30).
   */
  roundingTolerance: number | null;
  /** Meta de pareamento de §1.1 (única meta numérica já decidida). */
  minMatchRate: number;
  /** Revisões fixadas da medição (§16.1): código, conhecimento, léxico, modelo, política. */
  revisions: CorpusRevisions;
}

export const DEFAULT_CORPUS_RUN_OPTIONS: CorpusRunOptions = {
  roundingTolerance: null,
  minMatchRate: GOLDEN_CORPUS_MIN_MATCH_RATE,
  revisions: CORPUS_DECLARED_REVISIONS,
};

/** Falha classificada do harness. */
export interface CorpusFailure {
  caseId: string;
  /** Rótulo da decisão esperada; `null` para falha no nível do caso. */
  label: string | null;
  codes: CorpusFailureCode[];
  detail: string;
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
  /** `matchedCases / resolvableLabeled`; `null` quando o denominador é zero. */
  matchRate: number | null;
  /** `matchedCases / cases`; verifica também clarificação e rejeição. */
  decisionMatchRate: number | null;
  sampleStatus: "present" | "missing";
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

/** Resultado de um controle negativo. */
export interface NegativeControlResult {
  caseId: string;
  targetCaseId: string;
  /** O controle convergiu para a mesma saída do caso controlado. */
  convergedWithTarget: boolean;
}

/** Consistência de macros entre entradas equivalentes (§1.1). */
export interface MacroConsistencyResult {
  groupId: string;
  consistent: boolean;
  divergences: string[];
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
  holdoutKnowledgeWrites: { caseId: string; writes: string[] }[];
}

/** Veredito do gate do corpus. */
export interface CorpusGate {
  status: CorpusGateStatus;
  minMatchRate: number;
  matchRate: number | null;
  failureCount: number;
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
  failures: CorpusFailure[];
  metamorphic: MetamorphicGroupResult[];
  negativeControls: NegativeControlResult[];
  macroConsistency: MacroConsistencyResult[];
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
  if (decisions.every(item => item.nextAction === "propose"))
    return "resolvable";
  return "deferred";
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
    if (
      entry.expected.operation === null &&
      entry.expected.decisions.some(
        item => item.status === "unknown" && item.nextAction === "propose"
      )
    ) {
      invalidCases.push({
        caseId: entry.caseId,
        message: "status=unknown nunca produz propose (§5)",
      });
    }
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

    // Membros do mesmo grupo metamórfico compartilham a superfície
    // normalizada por declaração da referência independente (§4.1.8): a
    // variação de pontuação/acento é intencional e não é duplicata.
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
    negativeControlConflicts.length === 0 &&
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
    holdoutKnowledgeWrites: [],
  };
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

  if (expected.identity.asserted) {
    if (expected.identity.canonicalName !== projected.identity.canonicalName) {
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
      !sameSet(expected.identity.qualifiers, projected.identity.qualifierValues)
    ) {
      codes.push("qualifiers_mismatch");
    }
    if (expected.identity.barcode !== projected.identity.barcode) {
      codes.push("barcode_mismatch");
    }
  }

  if (expected.quantity.asserted) {
    // `value` é estrito: ausência declarada de quantidade não pode virar
    // número. `unit`, `grams`, `milliliters` e `measureKind` só são comparados
    // quando o caso os declara, porque são derivações dependentes de porção
    // (§8.3) e a ausência de tolerância calibrada não autoriza inventá-los.
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
      if (projected.quantity.grams !== null || projected.quantity.unitIsMass) {
        codes.push("quantity_became_grams");
      }
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

  if (
    expected.ambiguity.mustPreserveAlternatives &&
    projected.alternativeCount < expected.ambiguity.minAlternatives
  ) {
    codes.push("alternatives_lost");
  }

  const nutrition = expected.nutrition;
  if (nutrition.requirement !== "not_asserted") {
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
 * Casa as decisões esperadas com as decisões produzidas. A correspondência é
 * por rótulo explícito (`label`): o resolvedor declara `decisionId` e o corpus
 * declara `label`, então o casamento usa projeção semântica com busca
 * determinística.
 */
function matchDecisions(
  expected: readonly ExpectedDecision[],
  produced: readonly ProjectedDecision[]
): {
  assignments: { expected: ExpectedDecision; produced: ProjectedDecision }[];
  unmatchedExpected: ExpectedDecision[];
  unmatchedProduced: ProjectedDecision[];
  codesByLabel: Map<string, CorpusFailureCode[]>;
} {
  const codesByLabel = new Map<string, CorpusFailureCode[]>();
  const used = new Set<number>();
  const assignments: {
    expected: ExpectedDecision;
    produced: ProjectedDecision;
  }[] = [];
  const unmatchedExpected: ExpectedDecision[] = [];

  for (const item of expected) {
    let bestIndex = -1;
    let bestCodes: CorpusFailureCode[] = [];
    for (let index = 0; index < produced.length; index += 1) {
      if (used.has(index)) continue;
      const codes = compareExpectedDecision(item, produced[index]);
      if (codes.length === 0) {
        bestIndex = index;
        bestCodes = codes;
        break;
      }
      if (bestIndex === -1 || codes.length < bestCodes.length) {
        bestIndex = index;
        bestCodes = codes;
      }
    }

    if (bestIndex >= 0 && bestCodes.length === 0) {
      used.add(bestIndex);
      assignments.push({ expected: item, produced: produced[bestIndex] });
      continue;
    }

    unmatchedExpected.push(item);
    codesByLabel.set(
      item.label,
      bestCodes.length > 0 ? bestCodes : ["missing_decision"]
    );
  }

  const unmatchedProduced = produced.filter((_, index) => !used.has(index));

  return { assignments, unmatchedExpected, unmatchedProduced, codesByLabel };
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
  let resolveCalls = 0;

  for (const entry of parsed.cases) {
    resolveCalls += 1;
    const failures: CorpusFailure[] = [];
    const projections: ProjectedDecision[] = [];
    const rawDecisions: FoodResolutionDecision[] = [];
    let operation: MealOperation | null = null;
    let abstained = false;

    let result: Awaited<ReturnType<CorpusResolverUnderTest["resolve"]>>;
    try {
      result = await resolver.resolve({ case: entry, allowLearning: false });
    } catch (error) {
      failures.push({
        caseId: entry.caseId,
        label: null,
        codes: ["resolver_error"],
        detail:
          error instanceof Error
            ? `resolvedor lançou: ${error.message}`
            : "resolvedor lançou erro não identificado",
      });
      outcomes.push({
        case: entry,
        matched: false,
        abstained: true,
        failures,
        projections,
        operation,
        rawDecisions,
      });
      continue;
    }

    const writes = [...(result.knowledgeWrites ?? [])];
    if (writes.length > 0) {
      failures.push({
        caseId: entry.caseId,
        label: null,
        codes: ["learning_applied_during_measurement"],
        detail: `escritas de conhecimento durante a medição: ${writes.join(", ")}`,
      });
      if (entry.split === "holdout") {
        holdoutKnowledgeWrites.push({
          caseId: entry.caseId,
          writes,
        });
      }
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

    if (result.operation) {
      operation = result.operation;
    }

    const expectedView = entry.expected.decisions;
    const { unmatchedExpected, unmatchedProduced, codesByLabel } =
      matchDecisions(expectedView, projections);

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

    if (entry.expected.operation) {
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
            detail:
              "item não resolvido sem código de motivo estruturado (§7.2)",
          });
        }
      }
    }

    outcomes.push({
      case: entry,
      matched: failures.length === 0,
      abstained,
      failures,
      projections,
      operation,
      rawDecisions,
    });
  }

  integrity.holdoutKnowledgeWrites = holdoutKnowledgeWrites;
  if (holdoutKnowledgeWrites.length > 0) integrity.status = "invalid";

  const failures = outcomes.flatMap(outcome => outcome.failures);

  const byModality = [...groupBy(outcomes, outcome => [outcome.case.modality])]
    .map(([segment, list]) => buildSegment("modality", segment, list))
    .sort((a, b) => a.segment.localeCompare(b.segment, "pt-BR"));

  const byDecisionClass = [
    ...groupBy(outcomes, outcome => [outcome.case.decisionClass]),
  ]
    .map(([segment, list]) => buildSegment("decisionClass", segment, list))
    .sort((a, b) => a.segment.localeCompare(b.segment, "pt-BR"));

  const bySplit = [...groupBy(outcomes, outcome => [outcome.case.split])]
    .map(([segment, list]) => buildSegment("split", segment, list))
    .sort((a, b) => a.segment.localeCompare(b.segment, "pt-BR"));

  const byNonRecurrenceClass = [
    ...groupBy(outcomes, outcome => [...outcome.case.nonRecurrenceClasses]),
  ]
    .map(([segment, list]) =>
      buildSegment(
        "nonRecurrenceClass",
        segment as CorpusNonRecurrenceClass,
        list
      )
    )
    .sort((a, b) => a.segment.localeCompare(b.segment, "pt-BR"));

  const overall = buildSegment("modality", "corpus", outcomes);

  const outcomeByCaseId = new Map(
    outcomes.map(outcome => [outcome.case.caseId, outcome])
  );

  const metamorphic = buildMetamorphicResults(parsed, outcomeByCaseId);
  const negativeControls = buildNegativeControlResults(parsed, outcomeByCaseId);
  const macroConsistency = buildMacroConsistency(
    parsed,
    outcomeByCaseId,
    resolvedOptions.roundingTolerance
  );

  const wrongConvergence = metamorphic.filter(item => item.wrongConvergence);
  const convergedControls = negativeControls.filter(
    item => item.convergedWithTarget
  );

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
      integrity.negativeControlConflicts.length > 0
    ) {
      blockReasons.push("corpus_invalid");
    }
  }
  if (wrongConvergence.length > 0 || convergedControls.length > 0) {
    blockReasons.push("negative_control_convergence");
  }
  if (
    macroConsistency.some(item => !item.consistent) &&
    resolvedOptions.roundingTolerance === null
  ) {
    blockReasons.push("rounding_tolerance_not_calibrated");
  }

  const gate = buildGate(
    overall,
    failures.length,
    blockReasons,
    resolvedOptions.minMatchRate
  );

  return {
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
    failures,
    metamorphic,
    negativeControls,
    macroConsistency,
    gate,
  };
}

/** Executa o corpus canônico versionado. */
export async function runGoldenFoodCorpus(
  resolver: CorpusResolverUnderTest,
  options: Partial<CorpusRunOptions> = {}
): Promise<CorpusReport> {
  return runCorpus(goldenFoodCorpus, resolver, options);
}

function buildGate(
  overall: CorpusSegmentMetrics,
  failureCount: number,
  blockReasons: readonly CorpusGateBlockReason[],
  minMatchRate: number
): CorpusGate {
  const base = {
    minMatchRate,
    matchRate: overall.matchRate,
    failureCount,
    blockReasons: [...blockReasons],
  };

  if (blockReasons.length > 0) {
    return { ...base, status: "blocked" };
  }
  if (overall.resolvableLabeled === 0) {
    return { ...base, status: "sample_missing" };
  }
  if (failureCount > 0) {
    return { ...base, status: "failed" };
  }
  if (overall.matchRate !== null && overall.matchRate < minMatchRate) {
    return { ...base, status: "failed" };
  }
  return { ...base, status: "passed" };
}

function buildMetamorphicResults(
  corpus: GoldenCorpus,
  outcomeByCaseId: Map<string, CaseOutcome>
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
      projectionsEqual(outcome.projections, referenceProjection)
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

function projectionsEqual(
  a: readonly ProjectedDecision[],
  b: readonly ProjectedDecision[]
): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  const remaining = [...b];
  for (const decision of a) {
    const index = remaining.findIndex(candidate =>
      decisionsSemanticallyEqual(decision, candidate)
    );
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function buildNegativeControlResults(
  corpus: GoldenCorpus,
  outcomeByCaseId: Map<string, CaseOutcome>
): NegativeControlResult[] {
  const results: NegativeControlResult[] = [];
  for (const entry of corpus.cases) {
    if (!entry.negativeControlOf) continue;
    const control = outcomeByCaseId.get(entry.caseId);
    const target = outcomeByCaseId.get(entry.negativeControlOf);
    if (!control || !target) continue;
    results.push({
      caseId: entry.caseId,
      targetCaseId: entry.negativeControlOf,
      convergedWithTarget: projectionsEqual(
        control.projections,
        target.projections
      ),
    });
  }
  return results.sort((a, b) => a.caseId.localeCompare(b.caseId, "pt-BR"));
}

function buildMacroConsistency(
  corpus: GoldenCorpus,
  outcomeByCaseId: Map<string, CaseOutcome>,
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

/** Versão de schema corrente do corpus. */
export const CURRENT_CORPUS_SCHEMA_VERSION = GOLDEN_CORPUS_SCHEMA_VERSION;
