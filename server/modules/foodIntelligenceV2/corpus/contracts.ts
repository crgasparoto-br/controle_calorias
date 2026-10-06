/**
 * Contratos do Golden Food Corpus e do harness de calibração (issue #1299,
 * subissue de #1297; Fase A de §20 da ADR).
 *
 * Fonte canônica: `docs/design-docs/adr-food-intelligence-resolver-v2.md`
 * §1.1, §4.1.8, §8.12, §9.3, §16, §16.1, §16.2, §17 e §18.
 *
 * Invariantes estruturais desta camada:
 * - o resultado esperado de cada caso é declarado de forma independente da
 *   saída do resolvedor (§4.1.8) e nunca é derivado dela;
 * - o corpus é dado versionado; nenhum limiar numérico novo é aprovado aqui
 *   (§25 permanece `OPEN` fora da meta de §1.1);
 * - o módulo não é servido por produção (Fase A); a fronteira é travada por
 *   `noProductionConsumer.test.ts`.
 * - nenhuma decisão é fabricada pelo harness: o resolvedor sob teste é sempre
 *   uma implementação explícita (§18).
 */
import { z } from "zod";
import {
  FOOD_DECISION_NEXT_ACTIONS,
  FOOD_DECISION_STATUSES,
  FOOD_EVIDENCE_ORIGINS,
  FOOD_FIELD_VALUES,
  FOOD_INPUT_TYPES,
  FOOD_MEASURE_KINDS,
  FOOD_REASON_CODES,
  type FoodReasonCode,
} from "../contracts";
import type { FoodResolutionDecision, MealOperation } from "../schemas";

/** `schemaVersion` aceito pelo corpus. Versão desconhecida é rejeitada. */
export const GOLDEN_CORPUS_SCHEMA_VERSION = 1;

/** Identificador de versão do corpus completo (§16: corpus versionado). */
export const GOLDEN_CORPUS_VERSION = "golden-2026-10-06.1";

/**
 * Meta de pareamento correto de §1.1. Já decidida, portanto não é um limiar
 * `OPEN` de §25: é o único valor numérico que o harness compara por padrão.
 */
export const GOLDEN_CORPUS_MIN_MATCH_RATE = 0.95;

/**
 * Partições do corpus (§16.1 e §16.2). `acquisition` e `calibration` podem
 * alimentar conhecimento; `holdout` é reservado e não pode alimentar alias,
 * léxico, prompt, promoção ou memória durante a medição (§16.1, §16.2).
 */
export const CORPUS_SPLITS = ["acquisition", "calibration", "holdout"] as const;
export type CorpusSplit = (typeof CORPUS_SPLITS)[number];

/**
 * Classe de decisão esperada, alinhada a §1.1: casos resolvíveis entram no
 * denominador da meta; clarificação e rejeição também têm decisão esperada
 * verificável. A classe declarada é validada contra as decisões esperadas.
 */
export const CORPUS_DECISION_CLASSES = [
  "resolvable",
  "clarification",
  "rejection",
  "deferred",
] as const;
export type CorpusDecisionClass = (typeof CORPUS_DECISION_CLASSES)[number];

/**
 * `deferred` cobre resiliência/runtime (§19.6): a decisão esperada é `retry`
 * (ex.: provider indisponível), que não é pareamento correto nem clarificação
 * do usuário. Só `resolvable` entra no denominador da meta de §1.1.
 */

/** Classes de não-recorrência de §9.3 (A–L). O relatório fala a língua da matriz. */
export const CORPUS_NON_RECURRENCE_CLASSES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
] as const;
export type CorpusNonRecurrenceClass =
  (typeof CORPUS_NON_RECURRENCE_CLASSES)[number];

/** Ações de operação da refeição reconhecidas pelo corpus (§7). */
export const CORPUS_OPERATION_ACTIONS = [
  "add",
  "replace",
  "remove",
  "list",
  "unknown",
] as const;
export type CorpusOperationAction = (typeof CORPUS_OPERATION_ACTIONS)[number];

/** Posição do destino da refeição na superfície (§7.1). */
export const CORPUS_DESTINATION_POSITIONS = [
  "leading",
  "trailing",
  "embedded",
  "absent",
] as const;
export type CorpusDestinationPosition =
  (typeof CORPUS_DESTINATION_POSITIONS)[number];

/** Requisito nutricional esperado do caso (§9.2: procedência declarada). */
export const CORPUS_NUTRITION_REQUIREMENTS = [
  "not_asserted",
  "provenance_declared",
  "provisional_declared",
] as const;
export type CorpusNutritionRequirement =
  (typeof CORPUS_NUTRITION_REQUIREMENTS)[number];

/** Dimensões de segmentação obrigatórias do relatório (§16.2). */
export const CORPUS_SEGMENT_DIMENSIONS = [
  "modality",
  "decisionClass",
  "nonRecurrenceClass",
  "split",
] as const;
export type CorpusSegmentDimension = (typeof CORPUS_SEGMENT_DIMENSIONS)[number];

/** Revisões fixadas durante a medição (§16.1, §16.2). */
export const CORPUS_REVISION_KEYS = [
  "code",
  "knowledge",
  "lexicon",
  "model",
  "policy",
  "resolver",
] as const;
export type CorpusRevisionKey = (typeof CORPUS_REVISION_KEYS)[number];
export type CorpusRevisions = Record<CorpusRevisionKey, string>;

/** Código de falha/abstenção classificado pelo harness. */
export const CORPUS_FAILURE_CODES = [
  "decision_invalid",
  "resolver_error",
  "missing_decision",
  "status_mismatch",
  "next_action_mismatch",
  "identity_mismatch",
  "brand_mismatch",
  "variant_mismatch",
  "preparation_mismatch",
  "qualifiers_mismatch",
  "barcode_mismatch",
  "quantity_mismatch",
  "quantity_unit_mismatch",
  "quantity_became_grams",
  "measure_kind_mismatch",
  "unresolved_fields_mismatch",
  "reason_code_missing",
  "reason_code_forbidden",
  "alternatives_lost",
  "clarification_mismatch",
  "nutrition_missing",
  "nutrition_provenance_missing",
  "nutrition_origin_forbidden",
  "nutrition_generic_as_verified",
  "provisional_declaration_missing",
  "unexpected_decision",
  "operation_missing",
  "operation_mismatch",
  "exclusion_not_explained",
  "learning_applied_during_measurement",
] as const;
export type CorpusFailureCode = (typeof CORPUS_FAILURE_CODES)[number];

/** Estado do gate. */
export const CORPUS_GATE_STATUSES = [
  "passed",
  "failed",
  "blocked",
  "sample_missing",
] as const;
export type CorpusGateStatus = (typeof CORPUS_GATE_STATUSES)[number];

/**
 * Motivos de bloqueio. `rounding_tolerance_not_calibrated` nunca é resolvido
 * com número arbitrário: a tolerância de arredondamento de §1.1 é `OPEN` no
 * item 30 de §25.
 */
export const CORPUS_GATE_BLOCK_REASONS = [
  "rounding_tolerance_not_calibrated",
  "duplicate_cases",
  "split_leakage",
  "negative_control_convergence",
  "holdout_knowledge_write",
  "corpus_invalid",
] as const;
export type CorpusGateBlockReason = (typeof CORPUS_GATE_BLOCK_REASONS)[number];

const opaqueId = z.string().trim().min(1).max(120);
const nonEmptyText = z.string().trim().min(1).max(600);
const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_REF = /^#\d+$/;
const finiteNumber = z.number().finite();

const expectedIdentitySchema = z.strictObject({
  /** `false` quando o caso não afirma identidade para esta decisão. */
  asserted: z.boolean(),
  canonicalName: nullableText(300),
  brand: nullableText(200),
  variant: nullableText(200),
  preparation: z.array(nonEmptyText).max(20),
  /** Valores de qualificador observados; a projeção os preserva. */
  qualifiers: z.array(nonEmptyText).max(50),
  barcode: nullableText(64),
});

const expectedQuantitySchema = z.strictObject({
  /** `false` quando o caso não afirma quantidade para esta decisão. */
  asserted: z.boolean(),
  value: finiteNumber.nullable(),
  unit: nullableText(40),
  grams: finiteNumber.nullable(),
  milliliters: finiteNumber.nullable(),
  measureKind: z.enum(FOOD_MEASURE_KINDS).nullable(),
  /**
   * `true` quando a superfície é um termo incerto de porção (`tiquinho`,
   * `punhado`, `pratão`): a unidade não pode virar gramas (§16).
   */
  unitMustNotBeConvertedToGrams: z.boolean(),
});

const expectedNutritionSchema = z.strictObject({
  requirement: z.enum(CORPUS_NUTRITION_REQUIREMENTS),
  /** Origens permitidas para sustentar a nutrição do caso (§4.1.8). */
  allowedOrigins: z.array(z.enum(FOOD_EVIDENCE_ORIGINS)).max(20),
  /** Origens proibidas: presença aqui é falha explícita. */
  forbiddenOrigins: z.array(z.enum(FOOD_EVIDENCE_ORIGINS)).max(20),
  /** `true` exige `provisional=true` (§9.2/§10.1). */
  provisionalRequired: z.boolean(),
  /**
   * `true` quando um perfil genérico não pode ser apresentado como composição
   * `verified` do produto observado (§8.3, `#1088`).
   */
  genericProfileMustNotBeVerified: z.boolean(),
});

const expectedAmbiguitySchema = z.strictObject({
  mustPreserveAlternatives: z.boolean(),
  minAlternatives: z.number().int().min(0).max(20),
});

/** Campos que podem exigir clarificação (§16). */
const expectedClarificationSchema = z.strictObject({
  requiredFields: z
    .array(z.enum(FOOD_FIELD_VALUES))
    .max(FOOD_FIELD_VALUES.length),
});

/** Decisão esperada de um item (§5), independente da saída do resolvedor. */
export const expectedDecisionSchema = z.strictObject({
  label: opaqueId,
  status: z.enum(FOOD_DECISION_STATUSES),
  nextAction: z.enum(FOOD_DECISION_NEXT_ACTIONS),
  identity: expectedIdentitySchema,
  quantity: expectedQuantitySchema,
  nutrition: expectedNutritionSchema,
  ambiguity: expectedAmbiguitySchema,
  clarification: expectedClarificationSchema,
  unresolvedFields: z
    .array(z.enum(FOOD_FIELD_VALUES))
    .max(FOOD_FIELD_VALUES.length),
  /** Códigos de motivo que precisam estar presentes na decisão. */
  reasonCodes: z.array(z.enum(FOOD_REASON_CODES)).max(20),
  /** Códigos de motivo que não podem aparecer (§4.1.8, controles negativos). */
  forbiddenReasonCodes: z.array(z.enum(FOOD_REASON_CODES)).max(20),
});

export type ExpectedDecision = z.infer<typeof expectedDecisionSchema>;

const expectedOperationSchema = z.strictObject({
  action: z.enum(CORPUS_OPERATION_ACTIONS),
  targetMeal: nonEmptyText,
  date: z.string().regex(ISO_DATE),
});

const expectedSchema = z.strictObject({
  /** Multiplicidade: uma entrada pode gerar várias decisões (§7.2). */
  decisions: z.array(expectedDecisionSchema).min(1).max(20),
  /** Operação esperada da refeição (§7.1); `null` quando não afirmada. */
  operation: expectedOperationSchema.nullable(),
  /** Exige que toda decisão esperada `resolved` seja preservada (§7.2). */
  mustPreserveAllResolvedItems: z.boolean(),
  /** Exige explicação estruturada para cada item excluído (§7.2). */
  mustExplainExclusions: z.boolean(),
});

const corpusInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(20_000),
  transcription: nullableText(20_000),
  ocrText: nullableText(20_000),
  caption: nullableText(600),
  /** Referência sintética de mídia; nunca mídia real (§19.8). */
  imageRef: nullableText(120),
});

/**
 * Operação observada na superfície (§7.1). `targetMeal` e `date` podem ser
 * `null` quando a superfície não os declara; a decisão esperada correspondente
 * usa o contrato governado, que exige ambos.
 */
const corpusMealOperationSchema = z.strictObject({
  action: z.enum(CORPUS_OPERATION_ACTIONS),
  targetMeal: nullableText(120),
  date: z.string().regex(ISO_DATE).nullable(),
  destinationPosition: z.enum(CORPUS_DESTINATION_POSITIONS),
});

const equivalenceReferenceSchema = z.strictObject({
  /** Identificador da referência independente que declarou a equivalência. */
  declaredBy: nonEmptyText,
  note: nonEmptyText,
});

/**
 * Escopo sintético do cenário (§16.1). `ownerRef` e `conversationRef` são
 * referências sintéticas, nunca identidade real. Eles permitem provar
 * isolamento entre usuários e distinguir repetição intencional da mesma
 * superfície/chave (restart/reentrega, §16.1) de duplicata acidental.
 */
const scenarioSchema = z.strictObject({
  ownerRef: opaqueId,
  conversationRef: opaqueId,
  /**
   * `true` quando o caso repete deliberadamente a mesma superfície e a mesma
   * chave do entrypoint de outro caso para provar persistência/idempotência
   * após restart (§16.1). Fora desse motivo, repetição entre partições é
   * vazamento para o holdout (§16.2).
   */
  intentionalSurfaceReuse: z.boolean(),
});

/** Caso versionado do Golden Food Corpus (§16). */
export const goldenCorpusCaseSchema = z.strictObject({
  caseId: opaqueId,
  title: nonEmptyText,
  split: z.enum(CORPUS_SPLITS),
  modality: z.enum(FOOD_INPUT_TYPES),
  decisionClass: z.enum(CORPUS_DECISION_CLASSES),
  nonRecurrenceClasses: z
    .array(z.enum(CORPUS_NON_RECURRENCE_CLASSES))
    .min(1)
    .max(CORPUS_NON_RECURRENCE_CLASSES.length),
  /** `true` para incidente histórico já conhecido (§16.1). */
  knownRegression: z.boolean(),
  incidentRefs: z.array(z.string().regex(ISSUE_REF)).max(40),
  adrSections: z.array(nonEmptyText).min(1).max(20),
  scenario: scenarioSchema,
  input: corpusInputSchema,
  mealOperation: corpusMealOperationSchema,
  expected: expectedSchema,
  /** Caso que este controla negativamente; `null` quando não é controle. */
  negativeControlOf: opaqueId.nullable(),
  /** Grupo metamórfico de equivalência de superfície (§17). */
  metamorphicGroup: opaqueId.nullable(),
  /** Declaração de equivalência por referência independente (§4.1.8). */
  equivalenceReference: equivalenceReferenceSchema.nullable(),
  notes: nullableText(600),
});

export type GoldenCorpusCase = z.infer<typeof goldenCorpusCaseSchema>;

/** Corpus completo versionado. */
export const goldenCorpusSchema = z.strictObject({
  schemaVersion: z.literal(GOLDEN_CORPUS_SCHEMA_VERSION),
  corpusVersion: nonEmptyText,
  locale: z.literal("pt-BR"),
  description: nonEmptyText,
  cases: z.array(goldenCorpusCaseSchema).min(1),
});

export type GoldenCorpus = z.infer<typeof goldenCorpusSchema>;

/**
 * Resultado do resolvedor sob teste, como observado pelo harness. O harness
 * nunca constrói a decisão: ele recebe a decisão do resolvedor e a projeta.
 */
export interface CorpusResolverResult {
  /** Decisões estruturadas produzidas pelo resolvedor sob teste (§5). */
  decisions: readonly FoodResolutionDecision[];
  /** Operação da refeição resolvida (§7.1); `null` quando não resolvida. */
  operation?: MealOperation | null;
  /**
   * Escritas de conhecimento/memória observadas durante a resolução. Durante a
   * medição espera-se lista vazia; qualquer escrita em caso `holdout` bloqueia
   * (§16.1: holdout não alimenta aliases/prompts/promoção).
   */
  knowledgeWrites?: readonly string[];
}

/** Pedido entregue ao resolvedor sob teste pelo harness. */
export interface CorpusResolverRequest {
  case: GoldenCorpusCase;
  /** Sempre `false` durante a medição: o corpus não ensina o resolvedor. */
  allowLearning: boolean;
}

/**
 * Resolvedor sob teste. O harness exige uma implementação real: a decisão
 * final vem do resolvedor e nunca do harness (§18).
 */
export interface CorpusResolverUnderTest {
  /** Identidade do resolvedor avaliado (nunca um mock do próprio resolvedor). */
  readonly id: string;
  /** Versão do resolvedor avaliado, registrada no relatório (§16.1). */
  readonly revision: string;
  resolve(
    request: CorpusResolverRequest
  ): CorpusResolverResult | Promise<CorpusResolverResult>;
}

/** Códigos de motivo governados usados pela validação de `expected`. */
export const CORPUS_GOVERNED_REASON_CODES: readonly FoodReasonCode[] =
  FOOD_REASON_CODES;

/** Contexto de revisões usado no relatório quando o corpus é carregado. */
export const CORPUS_DECLARED_REVISIONS: CorpusRevisions = {
  code: "sha:unknown",
  knowledge: "kn-unset",
  lexicon: "lex-unset",
  model: "model-unset",
  policy: "pol-unset",
  resolver: "v2.0.0-contracts",
};
