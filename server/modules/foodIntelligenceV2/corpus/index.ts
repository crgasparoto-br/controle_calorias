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
  deriveDecisionClass,
  inspectCorpusIntegrity,
  reportRevisions,
  runCorpus,
  runGoldenFoodCorpus,
  CURRENT_CORPUS_SCHEMA_VERSION,
  type CorpusFailure,
  type CorpusGate,
  type CorpusIntegrityReport,
  type CorpusReport,
  type CorpusRunOptions,
  type CorpusSegmentMetrics,
  type MacroConsistencyResult,
  type MetamorphicGroupResult,
  type NegativeControlResult,
} from "./harness";
export {
  decisionsSemanticallyEqual,
  isCurrentDecisionSchemaVersion,
  isCurrentObservationSchemaVersion,
  projectDecision,
  projectObservation,
  sortDecisions,
  type ProjectedAlternative,
  type ProjectedDecision,
  type ProjectedIdentity,
  type ProjectedNutrition,
  type ProjectedObservation,
  type ProjectedQuantity,
} from "./projection";
export { renderCorpusReportMarkdown } from "./report";
