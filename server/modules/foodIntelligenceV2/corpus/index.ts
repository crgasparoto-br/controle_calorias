/**
 * Golden Food Corpus e harness de calibração do Food Intelligence Resolver V2
 * (issue #1299, épica #1297).
 *
 * Fonte canônica: `docs/design-docs/adr-food-intelligence-resolver-v2.md`
 * §1.1, §4.1.8, §8.12, §9.3, §16, §16.1, §16.2, §17 e §18.
 *
 * Este módulo declara o corpus, verifica sua integridade, executa o resolvedor
 * sob teste através do contrato público e produz relatório segmentado. Ele não
 * serve decisões produtivas e não aprova thresholds de §25.
 */
export * from "./contracts";
export { goldenFoodCorpus, goldenFoodCorpusCases } from "./data";
export {
  DEFAULT_CORPUS_RUN_OPTIONS,
  compareExpectedDecision,
  createKnowledgeStore,
  deriveDecisionClass,
  familyCounters,
  inspectCorpusIntegrity,
  reportRevisions,
  runCorpus,
  runGoldenFoodCorpus,
  runLearningScenarios,
  segmentKeysOf,
  type CaseSegmentKeys,
  type CorpusFailure,
  type CorpusFamilyCounters,
  type CorpusGate,
  type CorpusIntegrityReport,
  type CorpusKnowledgeStore,
  type CorpusReport,
  type CorpusRunOptions,
  type CorpusSegmentMetrics,
  type LearningScenarioResult,
  type LearningScenarioStepResult,
  type MacroConsistencyResult,
  type MetamorphicGroupResult,
  type NegativeControlEvidence,
} from "./harness";
export {
  classifyMeasureKind,
  decisionsSemanticallyEqual,
  isCurrentDecisionSchemaVersion,
  isCurrentObservationSchemaVersion,
  materialAttributeKey,
  projectDecision,
  projectExpectedDecision,
  projectObservation,
  projectionMultisetEqual,
  sortDecisions,
  type CorpusMeasureKind,
  type ProjectedAlternative,
  type ProjectedDecision,
  type ProjectedIdentity,
  type ProjectedNutrition,
  type ProjectedObservation,
  type ProjectedQuantity,
} from "./projection";
export {
  CANONICAL_ADR_PATH,
  CANONICAL_ADR_SHA256,
  CANONICAL_REFERENCE_SOURCE,
  declaredReferenceSections,
  missingReferenceSections,
  readCanonicalReference,
  type CanonicalReference,
} from "./referenceSource";
export { renderCorpusReport, renderCorpusReportMarkdown } from "./report";
