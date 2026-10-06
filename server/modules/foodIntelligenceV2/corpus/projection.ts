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
import { isMassUnit } from "../contracts";
import type {
  FoodDecisionStatus,
  FoodDecisionNextAction,
  FoodEvidenceOrigin,
  FoodField,
} from "../contracts";
import type { FoodResolutionDecision } from "../schemas";
import { FOOD_OBSERVATION_SCHEMA_VERSION } from "../contracts";
import type { FoodObservation } from "../schemas";
import { FOOD_RESOLUTION_DECISION_SCHEMA_VERSION } from "../contracts";

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

export interface ProjectedAlternative {
  name: string;
  brand: string | null;
  variant: string | null;
  preparation: readonly string[];
  qualifierValues: readonly string[];
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
    sameMultiset(
      a.alternatives.map(alternativeKey),
      b.alternatives.map(alternativeKey)
    )
  );
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

/**
 * `true` quando a decisão declara explicitamente que a observação pertence ao
 * contrato V2 corrente. Versão diferente é rejeitada, nunca interpretada
 * silenciosamente (§5.1).
 */
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
