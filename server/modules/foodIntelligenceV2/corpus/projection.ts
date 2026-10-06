/**
 * Projeção semântica de observações e decisões (§4.1.8).
 *
 * A equivalência de superfície compara a projeção semântica com o resultado
 * esperado, não a igualdade entre duas saídas do pipeline. A projeção preserva
 * identidade e qualificadores observados, quantidade/unidade, multiplicidade
 * dos itens, alternativas e campos não resolvidos.
 *
 * Identificadores de execução/observação, `rawInput`, `normalizedInput`, spans,
 * modalidade, trilhas de normalização, confiança e hashes de snapshot não
 * integram a igualdade literal: sua validade e rastreabilidade são verificadas
 * separadamente (§4.1.8).
 */
import {
  FOOD_OBSERVATION_SCHEMA_VERSION,
  FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
  isMassUnit,
  isVolumeUnit,
} from "../contracts";
import type {
  FoodDecisionNextAction,
  FoodDecisionStatus,
  FoodEvidenceOrigin,
  FoodField,
} from "../contracts";
import type { FoodObservation, FoodResolutionDecision } from "../schemas";
import type { ExpectedDecision } from "./contracts";

/** Identidade projetada de um item (§4.1.8). */
export interface ProjectedIdentity {
  canonicalName: string | null;
  brand: string | null;
  variant: string | null;
  preparation: readonly string[];
  /** Somente o valor observado do qualificador, em ordem de aparição. */
  qualifierValues: readonly string[];
  barcode: string | null;
  /** `true` quando a decisão sustenta identidade canônica com candidato/entidade. */
  sustained: boolean;
}

/** Quantidade projetada de um item (§4.1.8). */
export interface ProjectedQuantity {
  value: number | null;
  unit: string | null;
  grams: number | null;
  milliliters: number | null;
  measureKind: string | null;
  /** `true` quando a unidade é uma unidade de massa (§16, porção incerta). */
  unitIsMass: boolean;
}

/** Nutrição projetada: procedência, não valores brutos de fornecedor. */
export interface ProjectedNutrition {
  present: boolean;
  verified: boolean;
  provisional: boolean;
  /** Origens de evidência que sustentam campos `nutrition.*`. */
  origins: readonly FoodEvidenceOrigin[];
  /** Origens que sustentam campos `identity.*`. */
  identityOrigins: readonly FoodEvidenceOrigin[];
  /**
   * `true` quando `verified=true` é sustentado apenas por evidência de produto
   * específico (`nutrition_label`/`barcode`), e não por perfil genérico
   * (`#1088`, §8.3).
   */
  verifiedBySpecificEvidence: boolean;
  /**
   * Requisito declarado pela expectativa (`provenance_declared`,
   * `provisional_declared` ou `absent`); `null` na projeção de uma decisão
   * observada, que é medida pelo que produz.
   */
  requirement: string | null;
  /** Origens permitidas declaradas pela expectativa. */
  allowedOrigins: readonly string[];
  /** Origens proibidas declaradas pela expectativa. */
  forbiddenOrigins: readonly string[];
  /**
   * `true` quando a expectativa proíbe sustentar o valor por perfil genérico
   * (§8.3, `#1088`).
   */
  genericProfileMustNotBeVerified: boolean;
}

export interface ProjectedAlternative {
  name: string;
  brand: string | null;
  variant: string | null;
  preparation: readonly string[];
  qualifierValues: readonly string[];
}

/** Decisão projetada: unidade comparável de §4.1.8. */
export interface ProjectedDecision {
  label: string | null;
  status: FoodDecisionStatus;
  nextAction: FoodDecisionNextAction;
  identity: ProjectedIdentity;
  quantity: ProjectedQuantity;
  unresolvedFields: readonly FoodField[];
  reasonCodes: readonly string[];
  nutrition: ProjectedNutrition;
  alternatives: readonly ProjectedAlternative[];
  alternativeCount: number;
}

/** Observação projetada: identidade/quantidade observadas, sem normalização. */
export interface ProjectedObservation {
  modality: string;
  identity: {
    foodName: string | null;
    brand: string | null;
    variant: string | null;
    preparation: readonly string[];
    qualifierValues: readonly string[];
    barcode: string | null;
  };
  quantity: {
    value: number | null;
    unit: string | null;
    servingText: string | null;
  };
  alternativeCount: number;
  unresolvedReason: string | null;
}

/** Classe de medida usada na segmentação de §16.2. */
export const CORPUS_MEASURE_KINDS = [
  "none",
  "mass",
  "volume",
  "count",
  "household",
  "other",
] as const;
export type CorpusMeasureKind = (typeof CORPUS_MEASURE_KINDS)[number];

const COUNT_UNITS = [
  "unidade",
  "fatia",
  "porção",
  "pote",
  "copo",
  "garrafa",
  "lata",
  "pacote",
  "colher de sopa",
  "colher de chá",
];

const NUTRITION_FIELD_PREFIX = "nutrition.";
const IDENTITY_FIELD_PREFIX = "identity.";

const SPECIFIC_NUTRITION_ORIGINS: readonly FoodEvidenceOrigin[] = [
  "nutrition_label",
  "barcode",
];

/** Ordena mantendo estabilidade e sem depender da ordem de execução. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Classifica a unidade observada/esperada para a segmentação de §16.2. */
export function classifyMeasureKind(unit: string | null): CorpusMeasureKind {
  if (unit === null) return "none";
  if (isMassUnit(unit)) return "mass";
  if (isVolumeUnit(unit)) return "volume";
  if (COUNT_UNITS.some(candidate => candidate === unit.trim().toLowerCase())) {
    return unit.trim().toLowerCase().startsWith("colher")
      ? "household"
      : "count";
  }
  return "other";
}

/** Chave material de identidade: variante, preparo e qualificadores (§16.2). */
export function materialAttributeKey(identity: ProjectedIdentity): string {
  const parts = [
    ...identity.preparation,
    ...identity.qualifierValues,
    ...(identity.variant === null ? [] : [identity.variant]),
  ];
  const normalized = sortedUnique(parts);
  return normalized.length === 0 ? "none" : normalized.join("+");
}

/** Projeta uma decisão estruturada para comparação semântica (§4.1.8). */
export function projectDecision(
  decision: FoodResolutionDecision
): ProjectedDecision {
  const nutritionOrigins = sortedUnique(
    decision.evidence
      .filter(evidence => evidence.field.startsWith(NUTRITION_FIELD_PREFIX))
      .map(evidence => evidence.origin)
  ) as FoodEvidenceOrigin[];

  const identityOrigins = sortedUnique(
    decision.evidence
      .filter(evidence => evidence.field.startsWith(IDENTITY_FIELD_PREFIX))
      .map(evidence => evidence.origin)
  ) as FoodEvidenceOrigin[];

  const verifiedBySpecificEvidence = decision.evidence.some(
    evidence =>
      evidence.field.startsWith(NUTRITION_FIELD_PREFIX) &&
      evidence.verified &&
      SPECIFIC_NUTRITION_ORIGINS.includes(evidence.origin)
  );

  return {
    label: null,
    status: decision.status,
    nextAction: decision.nextAction,
    identity: {
      canonicalName: decision.identity.canonicalName,
      brand: decision.identity.brand,
      variant: decision.identity.variant,
      preparation: [...decision.identity.preparation],
      qualifierValues: decision.identity.qualifiers.map(
        qualifier => qualifier.value
      ),
      barcode: decision.identity.barcode,
      sustained:
        decision.identity.canonicalName !== null &&
        (decision.identity.foodEntityId !== null ||
          decision.identity.candidateKey !== null),
    },
    quantity: {
      value: decision.quantity.value,
      unit: decision.quantity.unit,
      grams: decision.quantity.grams,
      milliliters: decision.quantity.milliliters,
      measureKind: decision.quantity.measureKind,
      unitIsMass: isMassUnit(decision.quantity.unit),
    },
    unresolvedFields: sortedUnique(decision.unresolvedFields) as FoodField[],
    reasonCodes: sortedUnique(decision.reasonCodes),
    nutrition: {
      present:
        decision.nutrition.profileId !== null ||
        decision.nutrition.sourceId !== null ||
        decision.nutrition.basis !== null ||
        decision.nutrition.consumed !== null ||
        decision.nutrition.verified ||
        decision.nutrition.provisional,
      verified: decision.nutrition.verified,
      provisional: decision.nutrition.provisional,
      origins: nutritionOrigins,
      identityOrigins,
      verifiedBySpecificEvidence,
      requirement: null,
      allowedOrigins: [],
      forbiddenOrigins: [],
      genericProfileMustNotBeVerified: false,
    },
    alternatives: decision.alternatives.map(alternative => ({
      name: alternative.name,
      brand: alternative.brand,
      variant: alternative.variant,
      preparation: [...alternative.preparation],
      qualifierValues: alternative.qualifiers.map(qualifier => qualifier.value),
    })),
    alternativeCount: decision.alternatives.length,
  };
}

/**
 * Projeta a **expectativa declarada** no mesmo espaço da projeção observada.
 *
 * É o que permite validar, antes da medição, que todos os membros de um grupo
 * metamórfico realmente declaram o mesmo resultado esperado: um grupo com
 * expectativas divergentes é inválido, não uma equivalência.
 */
export function projectExpectedDecision(
  expected: ExpectedDecision
): ProjectedDecision {
  const identityExpected = expected.identity.presence === "expected";
  const quantityExpected = expected.quantity.presence === "expected";

  return {
    label: expected.label,
    status: expected.status,
    nextAction: expected.nextAction,
    identity: {
      canonicalName: identityExpected ? expected.identity.canonicalName : null,
      brand: identityExpected ? expected.identity.brand : null,
      variant: identityExpected ? expected.identity.variant : null,
      preparation: identityExpected ? [...expected.identity.preparation] : [],
      qualifierValues: identityExpected
        ? [...expected.identity.qualifiers]
        : [],
      barcode: identityExpected ? expected.identity.barcode : null,
      sustained: identityExpected && expected.identity.canonicalName !== null,
    },
    quantity: {
      value: quantityExpected ? expected.quantity.value : null,
      unit: quantityExpected ? expected.quantity.unit : null,
      grams: quantityExpected ? expected.quantity.grams : null,
      milliliters: quantityExpected ? expected.quantity.milliliters : null,
      measureKind: quantityExpected ? expected.quantity.measureKind : null,
      unitIsMass: quantityExpected && isMassUnit(expected.quantity.unit),
    },
    unresolvedFields: sortedUnique(expected.unresolvedFields) as FoodField[],
    reasonCodes: sortedUnique(expected.reasonCodes),
    nutrition: {
      present: expected.nutrition.requirement !== "absent",
      verified: false,
      provisional: expected.nutrition.provisionalRequired,
      origins: [],
      identityOrigins: [],
      verifiedBySpecificEvidence: false,
      requirement: expected.nutrition.requirement,
      allowedOrigins: sortedUnique(expected.nutrition.allowedOrigins),
      forbiddenOrigins: sortedUnique(expected.nutrition.forbiddenOrigins),
      genericProfileMustNotBeVerified:
        expected.nutrition.genericProfileMustNotBeVerified,
    },
    alternatives: expected.alternatives.map(alternative => ({
      name: alternative.name,
      brand: alternative.brand,
      variant: alternative.variant,
      preparation: [...alternative.preparation],
      qualifierValues: [...alternative.qualifiers],
    })),
    alternativeCount: expected.alternatives.length,
  };
}

/** Projeta uma observação pré-resolução para comparação de superfície. */
export function projectObservation(
  observation: FoodObservation
): ProjectedObservation {
  return {
    modality: observation.modality,
    identity: {
      foodName: observation.identityHints.foodName,
      brand: observation.identityHints.brand,
      variant: observation.identityHints.variant,
      preparation: [...observation.identityHints.preparation],
      qualifierValues: observation.identityHints.qualifiers.map(
        qualifier => qualifier.value
      ),
      barcode: observation.identityHints.barcode,
    },
    quantity: {
      value: observation.quantityHints.value,
      unit: observation.quantityHints.unit,
      servingText: observation.quantityHints.servingText,
    },
    alternativeCount: observation.alternatives.length,
    unresolvedReason: observation.unresolvedReason,
  };
}

/** Compara duas projeções de decisão por igualdade semântica multiconjunto. */
export function decisionsSemanticallyEqual(
  a: ProjectedDecision,
  b: ProjectedDecision
): boolean {
  return (
    a.status === b.status &&
    a.nextAction === b.nextAction &&
    a.identity.canonicalName === b.identity.canonicalName &&
    a.identity.brand === b.identity.brand &&
    a.identity.variant === b.identity.variant &&
    sameMultiset(a.identity.preparation, b.identity.preparation) &&
    sameMultiset(a.identity.qualifierValues, b.identity.qualifierValues) &&
    a.identity.barcode === b.identity.barcode &&
    a.quantity.value === b.quantity.value &&
    a.quantity.unit === b.quantity.unit &&
    a.quantity.grams === b.quantity.grams &&
    a.quantity.milliliters === b.quantity.milliliters &&
    a.quantity.measureKind === b.quantity.measureKind &&
    sameMultiset(a.unresolvedFields, b.unresolvedFields) &&
    sameMultiset(a.reasonCodes, b.reasonCodes) &&
    // Procedência nutricional entra na igualdade semântica: presença, origem,
    // verificação e declaração de provisório não dependem de arredondamento, e
    // tratá-las como irrelevantes faria duas decisões materialmente diferentes
    // convergirem. Os **valores** de macro ficam de fora de propósito: eles
    // dependem da tolerância de arredondamento de §1.1, ainda `OPEN` (§25 item
    // 30), e são medidos por `macroConsistency`, que bloqueia enquanto a
    // tolerância não estiver calibrada.
    a.nutrition.present === b.nutrition.present &&
    a.nutrition.verified === b.nutrition.verified &&
    a.nutrition.provisional === b.nutrition.provisional &&
    sameMultiset(a.nutrition.origins, b.nutrition.origins) &&
    sameMultiset(a.nutrition.identityOrigins, b.nutrition.identityOrigins) &&
    a.nutrition.verifiedBySpecificEvidence ===
      b.nutrition.verifiedBySpecificEvidence &&
    a.nutrition.requirement === b.nutrition.requirement &&
    sameMultiset(a.nutrition.allowedOrigins, b.nutrition.allowedOrigins) &&
    sameMultiset(a.nutrition.forbiddenOrigins, b.nutrition.forbiddenOrigins) &&
    a.nutrition.genericProfileMustNotBeVerified ===
      b.nutrition.genericProfileMustNotBeVerified &&
    sameMultiset(
      a.alternatives.map(alternativeKey),
      b.alternatives.map(alternativeKey)
    )
  );
}

/** Compara duas listas de projeções como multiconjunto determinístico. */
export function projectionMultisetEqual(
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

function alternativeKey(alternative: ProjectedAlternative): string {
  return [
    alternative.name,
    alternative.brand ?? "",
    alternative.variant ?? "",
    [...alternative.preparation].sort().join("|"),
    [...alternative.qualifierValues].sort().join("|"),
  ].join("::");
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x.localeCompare(y, "pt-BR"));
  const right = [...b].sort((x, y) => x.localeCompare(y, "pt-BR"));
  return left.every((value, index) => value === right[index]);
}

/** `true` quando a decisão pertence ao contrato V2 corrente (§5). */
export function isCurrentDecisionSchemaVersion(
  decision: FoodResolutionDecision
): boolean {
  return decision.schemaVersion === FOOD_RESOLUTION_DECISION_SCHEMA_VERSION;
}

/** `true` quando a observação declara o contrato V2 corrente (§4.2). */
export function isCurrentObservationSchemaVersion(
  observation: FoodObservation
): boolean {
  return observation.schemaVersion === FOOD_OBSERVATION_SCHEMA_VERSION;
}

/** Ordena decisões por chave estável para relatórios reproduzíveis. */
export function sortDecisions<T extends ProjectedDecision>(
  decisions: readonly T[]
): T[] {
  return [...decisions].sort((a, b) =>
    projectKey(a).localeCompare(projectKey(b), "pt-BR")
  );
}

function projectKey(decision: ProjectedDecision): string {
  return [
    decision.status,
    decision.nextAction,
    decision.identity.canonicalName ?? "",
    decision.identity.brand ?? "",
    decision.identity.variant ?? "",
    String(decision.quantity.value ?? ""),
    decision.quantity.unit ?? "",
  ].join("::");
}
