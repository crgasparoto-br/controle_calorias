/**
 * Contratos de runtime do Food Intelligence Resolver V2 (issue #1298, épica #1297).
 *
 * Fonte canônica: `docs/design-docs/adr-food-intelligence-resolver-v2.md`, seções
 * §4, §5, §7.1.1, §21.1, §22 e §25 (itens 1, 12, 14, 16 e 18).
 *
 * Este módulo declara apenas vocabulário governado, versões e helpers puros.
 * A validação de formato/estrutura fica em `schemas.ts`; a projeção para
 * consumidores legados fica em `adapters.ts`. Nenhum entrypoint produtivo é
 * migrado nesta entrega (Fase A1): o módulo não é importado por handlers,
 * routers, serviços de produção ou componentes de UI.
 */

/** Versão de contrato de `MealSemanticContract` (baseline V1 em `server/nutritionEngineTypes.ts`). */
export const MEAL_SEMANTIC_CONTRACT_VERSION = 1;

/** `schemaVersion` aceito por `FoodObservation` (§4). */
export const FOOD_OBSERVATION_SCHEMA_VERSION = 2;

/** `schemaVersion` aceito por `FoodResolutionDecision` (§5). */
export const FOOD_RESOLUTION_DECISION_SCHEMA_VERSION = 2;

/** Locale do primeiro recorte (§4.2, item 14). */
export const DEFAULT_FOOD_LOCALE = "pt-BR" as const;

export const FOOD_FIELD_VALUES = [
  "identity",
  "variant",
  "quantity",
  "nutrition",
] as const;

export type FoodField = (typeof FOOD_FIELD_VALUES)[number];

export const FOOD_INPUT_TYPES = [
  "text",
  "audio_transcript",
  "image",
  "multimodal",
] as const;

export type FoodInputType = (typeof FOOD_INPUT_TYPES)[number];

/**
 * Origens de evidência aceitas (§4). Reutiliza o vocabulário de
 * `server/nutritionEngineTypes.ts` e acrescenta `barcode` como evidência
 * explícita, nunca inferida.
 */
export const FOOD_EVIDENCE_ORIGINS = [
  "text",
  "transcription",
  "ocr",
  "vision",
  "memory",
  "catalog",
  "web_research",
  "nutrition_label",
  "barcode",
  "provisional_estimate",
  "ai_estimate",
  "heuristic",
  "unavailable",
] as const;

export type FoodEvidenceOrigin = (typeof FOOD_EVIDENCE_ORIGINS)[number];

/**
 * Origens que representam evidência observada e verificável. Origens de
 * estimativa da IA, heurística, estimativa provisória ou indisponibilidade não
 * podem declarar `verified=true`: a LCL não declara verificação por confiança
 * autodeclarada (§4).
 */
export const FOOD_GROUNDED_EVIDENCE_ORIGINS = [
  "text",
  "transcription",
  "ocr",
  "vision",
  "memory",
  "catalog",
  "web_research",
  "nutrition_label",
  "barcode",
] as const satisfies readonly FoodEvidenceOrigin[];

const GROUNDED_EVIDENCE_ORIGIN_SET = new Set<string>(
  FOOD_GROUNDED_EVIDENCE_ORIGINS
);

/** `true` quando a origem pode sustentar `verified=true`. */
export function isGroundedEvidenceOrigin(origin: FoodEvidenceOrigin): boolean {
  return GROUNDED_EVIDENCE_ORIGIN_SET.has(origin);
}

/** Estágios da Camada de Compreensão Linguística (§4.1.3). */
export const FOOD_NORMALIZATION_STAGES = ["S1", "S2", "S3"] as const;
export type FoodNormalizationStage = (typeof FOOD_NORMALIZATION_STAGES)[number];

export const FOOD_NORMALIZATION_ORIGINS = [
  "deterministic",
  "lexicon",
  "interpreter",
] as const;
export type FoodNormalizationOrigin =
  (typeof FOOD_NORMALIZATION_ORIGINS)[number];

/**
 * Acoplamento estágio → origem (§4.1.3/§4.1.7). `S1` é determinístico, `S2` é
 * léxico governado e `S3` é interpretação semântica residual versionada.
 */
export const FOOD_STAGE_ORIGIN: Record<
  FoodNormalizationStage,
  FoodNormalizationOrigin
> = {
  S1: "deterministic",
  S2: "lexicon",
  S3: "interpreter",
};

export const FOOD_LOCALE_STATUSES = [
  "explicit",
  "defaulted",
  "unsupported",
] as const;
export type FoodLocaleStatus = (typeof FOOD_LOCALE_STATUSES)[number];

export const FOOD_DECISION_STATUSES = [
  "resolved",
  "partially_resolved",
  "ambiguous",
  "unknown",
] as const;
export type FoodDecisionStatus = (typeof FOOD_DECISION_STATUSES)[number];

export const FOOD_DECISION_NEXT_ACTIONS = [
  "propose",
  "clarify",
  "reject",
  "retry",
] as const;
export type FoodDecisionNextAction =
  (typeof FOOD_DECISION_NEXT_ACTIONS)[number];

/**
 * Precedência de `status` → ações permitidas (§5). `unknown` nunca produz
 * `propose`; `resolved` produz somente `propose`.
 */
export const FOOD_STATUS_ALLOWED_ACTIONS: Record<
  FoodDecisionStatus,
  readonly FoodDecisionNextAction[]
> = {
  resolved: ["propose"],
  partially_resolved: ["clarify", "retry"],
  ambiguous: ["clarify"],
  unknown: ["clarify", "retry", "reject"],
};

/**
 * Registro tipado de motivos. Preserva os códigos comerciais existentes e
 * distingue os códigos estruturais exigidos por §5. Acrescentar motivo exige
 * contrato/teste, nunca mensagem livre interpretada como controle de fluxo.
 */
export const FOOD_REASON_CODES = [
  "brand_variant_unresolved",
  "commercial_identity_unverified",
  "commercial_nutrition_unverified",
  "image_identity_unresolved",
  "unknown_surface",
  "unsupported_locale",
  "non_food",
  "unreadable_evidence",
  "quantity_missing",
  "quantity_conversion_unproven",
  "source_conflict",
  "provider_unavailable",
  "context_unavailable",
  "policy_not_calibrated",
  "unsupported_schema_version",
] as const;
export type FoodReasonCode = (typeof FOOD_REASON_CODES)[number];

/** Medida declarada da quantidade resolvida (§5). */
export const FOOD_MEASURE_KINDS = [
  "exact",
  "usual_average",
  "contextual_estimate",
] as const;
export type FoodMeasureKind = (typeof FOOD_MEASURE_KINDS)[number];

/** Bases físicas explícitas aceitas em `nutrition.basis` (§5). */
export const FOOD_NUTRITION_BASE_UNITS = ["g", "ml", "serving"] as const;
export type FoodNutritionBaseUnit = (typeof FOOD_NUTRITION_BASE_UNITS)[number];

export const FOOD_PROCESSING_LEVELS = [
  "natural_or_minimally_processed",
  "processed_culinary_ingredient",
  "processed",
  "ultra_processed",
] as const;

/**
 * Status de contexto do envelope interno (§1.2/§4). Falha de consulta não pode
 * virar ausência ou não aplicabilidade.
 */
export const FOOD_CONTEXT_STATUSES = [
  "available",
  "absent",
  "expired",
  "unavailable",
  "not_applicable",
] as const;
export type FoodContextStatus = (typeof FOOD_CONTEXT_STATUSES)[number];

export const FOOD_CONTEXT_SOURCE_NAMES = [
  "previousMessage",
  "preferences",
  "recentHistory",
] as const;
export type FoodContextSourceName = (typeof FOOD_CONTEXT_SOURCE_NAMES)[number];

/** Revisões fixadas no envelope da operação (§4/§21.1). */
export const FOOD_ENVELOPE_REVISION_KEYS = [
  "code",
  "knowledge",
  "lexicon",
  "policy",
  "resolver",
] as const;
export type FoodEnvelopeRevisionKey =
  (typeof FOOD_ENVELOPE_REVISION_KEYS)[number];

/**
 * Unidades de massa reconhecidas para normalização de base física. A base física
 * permanece explícita; nenhuma conversão implícita é autorizada (§5).
 */
export const FOOD_MASS_UNITS = [
  "g",
  "grama",
  "gramas",
  "gram",
  "grams",
  "kg",
  "quilo",
  "quilos",
  "kilogram",
  "kilograms",
] as const;

/** Unidades de volume reconhecidas. */
export const FOOD_VOLUME_UNITS = [
  "ml",
  "mililitro",
  "mililitros",
  "milliliter",
  "milliliters",
  "l",
  "litro",
  "litros",
  "liter",
  "liters",
] as const;

const MASS_UNIT_SET = new Set<string>(FOOD_MASS_UNITS);
const VOLUME_UNIT_SET = new Set<string>(FOOD_VOLUME_UNITS);

/** Normaliza um token de unidade para comparação determinística. */
export function normalizeUnitToken(unit: string | null | undefined): string {
  return (unit ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

export function isMassUnit(unit: string | null | undefined): boolean {
  return MASS_UNIT_SET.has(normalizeUnitToken(unit));
}

export function isVolumeUnit(unit: string | null | undefined): boolean {
  return VOLUME_UNIT_SET.has(normalizeUnitToken(unit));
}

/** Tolerância numérica para comparação de valores físicos comprovados. */
export const FOOD_QUANTITY_EPSILON = 1e-6;

/** Caminho de campo de evidência validado pelo contrato (§4). */
export const FOOD_EVIDENCE_FIELD_PATTERN =
  /^(identity|variant|quantity|nutrition)\.[A-Za-z][A-Za-z0-9_]*$/;

export function isEvidenceFieldPath(value: string): boolean {
  return FOOD_EVIDENCE_FIELD_PATTERN.test(value);
}

/** Campos de identidade reconhecidos como caminhos de evidência (§4). */
export const FOOD_EVIDENCE_FIELDS = [
  "identity.foodName",
  "identity.brand",
  "identity.variant",
  "identity.preparation",
  "identity.qualifiers",
  "identity.barcode",
  "variant.candidateKey",
  "variant.foodEntityId",
  "variant.variantId",
  "quantity.value",
  "quantity.unit",
  "quantity.grams",
  "quantity.milliliters",
  "quantity.portionId",
  "quantity.measureKind",
  "nutrition.calories",
  "nutrition.protein",
  "nutrition.carbs",
  "nutrition.fat",
  "nutrition.fiber",
  "nutrition.sugar",
  "nutrition.sodiumMg",
  "nutrition.profileId",
  "nutrition.sourceId",
  "nutrition.basis",
] as const;

const EVIDENCE_FIELD_SET = new Set<string>(FOOD_EVIDENCE_FIELDS);

/**
 * `true` quando o caminho é um campo governado do contrato. Caminhos fora do
 * vocabulário governado são rejeitados: payload arbitrário de provider não
 * substitui o contrato (§5.1).
 */
export function isGovernedEvidenceField(value: string): boolean {
  return EVIDENCE_FIELD_SET.has(value);
}

/** Limites de tamanho usados para manter o contrato finito e auditável. */
export const FOOD_CONTRACT_LIMITS = {
  rawText: 20_000,
  identifier: 200,
  shortText: 120,
  nameText: 300,
  collection: 200,
  qualifiers: 50,
  alternatives: 20,
  observations: 100,
} as const;
