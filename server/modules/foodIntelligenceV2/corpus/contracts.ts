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
 * - a entrada entregue ao resolvedor é sanitizada (`CorpusCaseInput`): ela não
 *   contém `expected`, partição, rótulos nem controles, para que nenhum
 *   resolvedor possa copiar o oráculo;
 * - o harness não fabrica decisão: ele apenas projeta a decisão devolvida por
 *   `resolve()` (§18);
 * - nenhum limiar numérico novo é aprovado aqui (§25 permanece `OPEN` fora da
 *   meta de §1.1);
 * - o módulo não é servido por produção (Fase A); a fronteira é travada por
 *   `noProductionConsumer.test.ts`.
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
export const GOLDEN_CORPUS_VERSION = "golden-2026-10-06.2";

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

export const FOOD_INPUT_TYPE_VALUES = FOOD_INPUT_TYPES;
export type CorpusModality = (typeof FOOD_INPUT_TYPES)[number];

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

/**
 * Presença esperada de um campo material na decisão.
 *
 * Três estados, porque "não afirmar" e "exigir ausência" são obrigações
 * diferentes: `expected` compara os valores declarados; `forbidden` reprova
 * qualquer valor produzido (uma decisão de rejeição/ambiguidade não pode
 * inventar identidade nem quantidade); `unspecified` não compara, e existe
 * apenas onde produzir o campo é legítimo (item proposto cuja superfície não
 * declarou quantidade, §8.3).
 */
export const CORPUS_FIELD_PRESENCE = [
  "expected",
  "forbidden",
  "unspecified",
] as const;
export type CorpusFieldPresence = (typeof CORPUS_FIELD_PRESENCE)[number];

/**
 * Requisito nutricional esperado do caso (§9.2: procedência declarada; §8.3:
 * perfil genérico não pode ser apresentado como composição verificada).
 */
export const CORPUS_NUTRITION_REQUIREMENTS = [
  "absent",
  "provenance_declared",
  "provisional_declared",
  "unspecified",
] as const;
export type CorpusNutritionRequirement =
  (typeof CORPUS_NUTRITION_REQUIREMENTS)[number];

/**
 * Dimensões de segmentação obrigatórias do relatório (§16.2): a média global
 * não pode esconder regressão concentrada por modalidade, marca, atributo
 * material, medida, continuidade, operação, classe de decisão, partição ou
 * classe de não-recorrência.
 */
export const CORPUS_SEGMENT_DIMENSIONS = [
  "modality",
  "decisionClass",
  "nonRecurrenceClass",
  "split",
  "brand",
  "materialAttribute",
  "measure",
  "continuity",
  "operation",
  "nutritionSource",
] as const;
export type CorpusSegmentDimension = (typeof CORPUS_SEGMENT_DIMENSIONS)[number];

/** Fases dos cenários de aprendizado/generalização de §16.1. */
export const CORPUS_LEARNING_PHASES = [
  "before_acquisition",
  "acquisition",
  "reserved_measurement",
  "restart",
  "explicit_override",
  "isolation",
  "revocation",
] as const;
export type CorpusLearningPhase = (typeof CORPUS_LEARNING_PHASES)[number];

/** Continuidade conversacional do caso (§16.2: medir continuidade). */
export const CORPUS_CONTINUITY = ["standalone", "continues_context"] as const;
export type CorpusContinuity = (typeof CORPUS_CONTINUITY)[number];

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

/**
 * Marcadores de revisão não fixada. O gate bloqueia enquanto qualquer revisão
 * permanecer neste estado: medir sem revisão amarrada não produz evidência
 * reproduzível (§16.1).
 */
export const CORPUS_UNPINNED_REVISION_MARKERS = [
  "unset",
  "unknown",
  "unpinned",
  "tbd",
] as const;

/** Código de falha/abstenção classificado pelo harness. */
export const CORPUS_FAILURE_CODES = [
  "decision_invalid",
  "resolver_error",
  "missing_decision",
  "status_mismatch",
  "next_action_mismatch",
  "identity_mismatch",
  "identity_present_unexpected",
  "brand_mismatch",
  "variant_mismatch",
  "preparation_mismatch",
  "qualifiers_mismatch",
  "barcode_mismatch",
  "quantity_mismatch",
  "quantity_unit_mismatch",
  "quantity_present_unexpected",
  "quantity_became_grams",
  "measure_kind_mismatch",
  "unresolved_fields_mismatch",
  "reason_code_missing",
  "reason_code_forbidden",
  "alternatives_lost",
  "alternatives_mismatch",
  "clarification_mismatch",
  "nutrition_missing",
  "nutrition_provenance_missing",
  "nutrition_origin_forbidden",
  "nutrition_generic_as_verified",
  "nutrition_present_unexpected",
  "provisional_declaration_missing",
  "unexpected_decision",
  "operation_missing",
  "operation_mismatch",
  "exclusion_not_explained",
  "learning_applied_during_measurement",
  "scenario_step_mismatch",
  "scenario_invariant_violated",
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
 * item 30 de §25. `revisions_not_pinned` bloqueia medição sem revisões
 * amarradas (§16.1).
 */
export const CORPUS_GATE_BLOCK_REASONS = [
  "rounding_tolerance_not_calibrated",
  "revisions_not_pinned",
  "duplicate_cases",
  "split_leakage",
  "negative_control_convergence",
  "holdout_knowledge_write",
  "scenario_invariant_violated",
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
  /** `expected` compara; `forbidden` exige ausência; `unspecified` ignora. */
  presence: z.enum(CORPUS_FIELD_PRESENCE),
  canonicalName: nullableText(300),
  brand: nullableText(200),
  variant: nullableText(200),
  preparation: z.array(nonEmptyText).max(20),
  /** Valores de qualificador observados; a projeção os preserva. */
  qualifiers: z.array(nonEmptyText).max(50),
  barcode: nullableText(64),
});

const expectedQuantitySchema = z.strictObject({
  presence: z.enum(CORPUS_FIELD_PRESENCE),
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

/** Alternativa esperada: a preservação é semântica, não apenas cardinal. */
const expectedAlternativeSchema = z.strictObject({
  name: nonEmptyText,
  brand: nullableText(200),
  variant: nullableText(200),
  preparation: z.array(nonEmptyText).max(20),
  qualifiers: z.array(nonEmptyText).max(50),
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
  /** Alternativas materialmente concorrentes esperadas (§4.1.8, §16). */
  alternatives: z.array(expectedAlternativeSchema).max(20),
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

export type CorpusInput = z.infer<typeof corpusInputSchema>;

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

export type CorpusMealOperation = z.infer<typeof corpusMealOperationSchema>;

const equivalenceReferenceSchema = z.strictObject({
  /** Identificador da referência independente que declarou a equivalência. */
  declaredBy: nonEmptyText,
  note: nonEmptyText,
});

export type CorpusEquivalenceReference = z.infer<
  typeof equivalenceReferenceSchema
>;

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

export type CorpusScenario = z.infer<typeof scenarioSchema>;

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
  /** Continuidade conversacional declarada (§16.2). */
  continuity: z.enum(CORPUS_CONTINUITY),
  /** Cenário de aprendizado do qual o caso é passo (§16.1); `null` quando não é. */
  learningScenarioId: opaqueId.nullable(),
  input: corpusInputSchema,
  mealOperation: corpusMealOperationSchema,
  expected: expectedSchema,
  /** Caso que este controla negativamente; `null` quando não é controle. */
  negativeControlOf: opaqueId.nullable(),
  /** Implementação errada plausível que este controle precisa reprovar. */
  negativeControlHypothesis: nullableText(600),
  /** Grupo metamórfico de equivalência de superfície (§17). */
  metamorphicGroup: opaqueId.nullable(),
  /** Declaração de equivalência por referência independente (§4.1.8). */
  equivalenceReference: equivalenceReferenceSchema.nullable(),
  notes: nullableText(600),
});

export type GoldenCorpusCase = z.infer<typeof goldenCorpusCaseSchema>;

/** Passo de um cenário de aprendizado (§16.1). */
const learningScenarioStepSchema = z.strictObject({
  stepId: opaqueId,
  phase: z.enum(CORPUS_LEARNING_PHASES),
  caseId: opaqueId,
  /**
   * `true` apenas na fase de aquisição: fora dela, qualquer escrita de
   * conhecimento é bloqueada e registrada (§16.1).
   */
  writesAllowed: z.boolean(),
  /**
   * Chaves revogadas pelo harness **antes** do passo. É o que prova que a
   * revogação não é reaplicada por cache obsoleto (§16.1).
   */
  revokeKeys: z.array(nonEmptyText).max(10),
  /** Exige resultado idêntico ao de outro passo (persistência/idempotência). */
  sameResultAsStepId: opaqueId.nullable(),
  /** Exige resultado diferente de outro passo (isolamento/revogação). */
  differentFromStepId: opaqueId.nullable(),
});

export type CorpusLearningScenarioStep = z.infer<
  typeof learningScenarioStepSchema
>;

/**
 * Cenário de aprendizado/generalização de §16.1. Diferente de um caso
 * isolado, ele executa passos ordenados contra a **mesma** instância do
 * resolvedor, com efeitos observáveis: estado anterior, aquisição, medição
 * reservada, reinício com a mesma chave, precedência explícita, isolamento e
 * revogação.
 */
export const goldenLearningScenarioSchema = z.strictObject({
  scenarioId: opaqueId,
  title: nonEmptyText,
  adrSections: z.array(nonEmptyText).min(1).max(20),
  reference: equivalenceReferenceSchema,
  steps: z.array(learningScenarioStepSchema).min(2).max(20),
});

export type GoldenLearningScenario = z.infer<
  typeof goldenLearningScenarioSchema
>;

/** Corpus completo versionado. */
export const goldenCorpusSchema = z.strictObject({
  schemaVersion: z.literal(GOLDEN_CORPUS_SCHEMA_VERSION),
  corpusVersion: nonEmptyText,
  locale: z.literal("pt-BR"),
  description: nonEmptyText,
  cases: z.array(goldenCorpusCaseSchema).min(1),
  /**
   * Cenários de §16.1. O corpus canônico declara pelo menos um (verificado em
   * `data.test.ts`); a lista pode ser vazia em recortes sintéticos usados para
   * provar o próprio harness.
   */
  learningScenarios: z.array(goldenLearningScenarioSchema).max(20),
});

export type GoldenCorpus = z.infer<typeof goldenCorpusSchema>;

/**
 * Entrada sanitizada entregue ao resolvedor sob teste. Ela contém apenas o que
 * um resolvedor produtivo receberia: identidade do caso, modalidade, entrada
 * observada, operação observada e escopo sintético de proprietário/conversa.
 * `expected`, partição, classe, grupos, controles e referências de equivalência
 * ficam **fora** da entrada, para que nenhum resolvedor possa copiar o oráculo.
 */
export interface CorpusCaseInput {
  readonly caseId: string;
  readonly modality: CorpusModality;
  readonly input: Readonly<CorpusInput>;
  readonly mealOperation: Readonly<CorpusMealOperation>;
  readonly scenario: Readonly<{
    ownerRef: string;
    conversationRef: string;
  }>;
}

/** Registro do ledger de conhecimento observado durante a medição. */
export interface CorpusKnowledgeLedgerEntry {
  caseId: string;
  split: CorpusSplit;
  operation: "read" | "write_attempt";
  key: string;
}

/**
 * Fachada de conhecimento entregue ao resolvedor. Ela é a única porta de
 * acesso a conhecimento durante a medição, e por isso o modo é uma capacidade,
 * não uma convenção: fora da fase de aquisição `write` registra a tentativa e
 * é rejeitada (§16.1: holdout não alimenta aliases/prompts/promoção).
 */
export interface CorpusKnowledgeGate {
  readonly mode: "read_only" | "acquisition";
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

/** Métricas de custo/latência opcionais reportadas pelo resolvedor (§16.2). */
export interface CorpusResolverMetrics {
  latencyMs?: number;
  costUsd?: number;
}

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
   * Escritas de conhecimento declaradas pelo próprio resolvedor. A evidência
   * primária de efeito é o ledger da `CorpusKnowledgeGate`; esta lista existe
   * para que um resolvedor declare uma escrita que não tenha passado pela
   * fachada (o que também é falha).
   */
  knowledgeWrites?: readonly string[];
  /** Latência/custo quando o resolvedor os expõe (§16.2). */
  metrics?: CorpusResolverMetrics;
}

/** Pedido entregue ao resolvedor sob teste pelo harness. */
export interface CorpusResolverRequest {
  /** Entrada sanitizada; nunca contém o resultado esperado. */
  case: CorpusCaseInput;
  /**
   * `true` apenas na fase de aquisição de um cenário de §16.1. Na medição
   * reservada é sempre `false`.
   */
  allowLearning: boolean;
  /** Fachada de conhecimento instrumentada (única porta de acesso). */
  knowledge: CorpusKnowledgeGate;
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

/**
 * Cria a entrada sanitizada de um caso. Congela a estrutura para que um
 * resolvedor não possa mutar o caso do corpus.
 */
export function toCorpusCaseInput(entry: GoldenCorpusCase): CorpusCaseInput {
  const input: CorpusCaseInput = {
    caseId: entry.caseId,
    modality: entry.modality,
    input: Object.freeze({ ...entry.input }),
    mealOperation: Object.freeze({ ...entry.mealOperation }),
    scenario: Object.freeze({
      ownerRef: entry.scenario.ownerRef,
      conversationRef: entry.scenario.conversationRef,
    }),
  };
  return Object.freeze(input);
}

/** Códigos de motivo governados usados pela validação de `expected`. */
export const CORPUS_GOVERNED_REASON_CODES: readonly FoodReasonCode[] =
  FOOD_REASON_CODES;

/**
 * Revisões declaradas **não fixadas**: usadas apenas em fixtures explicitamente
 * não avaliativas. Execução real exige revisões amarradas, senão o gate bloqueia
 * com `revisions_not_pinned` (§16.1).
 */
export const CORPUS_UNPINNED_REVISIONS: CorpusRevisions = {
  code: "unset",
  knowledge: "unset",
  lexicon: "unset",
  model: "unset",
  policy: "unset",
  resolver: "unset",
};

/** `true` quando a revisão não está amarrada a um material identificável. */
export function isUnpinnedRevision(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return CORPUS_UNPINNED_REVISION_MARKERS.some(marker =>
    normalized.includes(marker)
  );
}
