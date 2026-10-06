/**
 * Adapters explícitos de compatibilidade V1↔V2 (§21.1).
 *
 * Fonte canônica: `docs/design-docs/adr-food-intelligence-resolver-v2.md` §6, §21.1
 * e §22. Cada adapter existe para declarar, de forma verificável, o que um
 * consumidor V1 ainda não migrado consegue representar com fidelidade — e o que
 * ele não consegue.
 *
 * Invariantes aplicadas aqui:
 * - `MealSemanticContract` V1 é montado depois da resolução e **não** é observação
 *   pré-resolução: não pode ser convertido em `FoodObservation[]`;
 * - projeção V2 → DTO V1 preserva estado, quantidade, fonte e provisoriedade e
 *   nunca converte incompatibilidade em zeros/`verified` nem reinfere texto;
 * - `foodEntityId` não é `foodCatalogId` (§21.1);
 * - base `ml` não é projetada em gramas sem relação comprovada (§5);
 * - snapshot histórico é lido pela versão conhecida, sem reinferência, sem
 *   recálculo de macros, sem evidência fabricada e sem backfill destrutivo (§6);
 * - origem por campo é preservada: texto e transcrição equivalentes permanecem
 *   origens distintas (§4.1.5).
 *
 * Nada neste módulo é consumido por entrypoint produtivo (Fase A1, item 1 de
 * §21.1). As dependências de V1 são apenas de tipo.
 */
import type {
  FoodClassificationEstimate,
  MealProcessingResult,
  MealSemanticContract,
  MealSemanticEvidenceOrigin,
  MealItemResolutionMetadata,
} from "../../nutritionEngineTypes";
import {
  MEAL_SEMANTIC_CONTRACT_VERSION,
  isGroundedEvidenceOrigin,
  isVolumeUnit,
  type FoodEvidenceOrigin,
} from "./contracts";
import type {
  FoodDecisionClassification,
  FoodNutritionValues,
  FoodResolutionDecision,
} from "./schemas";

/** Origens de evidência do vocabulário V1 (tudo exceto `barcode`). */
export const V1_EVIDENCE_ORIGINS = [
  "text",
  "transcription",
  "ocr",
  "vision",
  "memory",
  "catalog",
  "web_research",
  "nutrition_label",
  "provisional_estimate",
  "ai_estimate",
  "heuristic",
  "unavailable",
] as const satisfies readonly MealSemanticEvidenceOrigin[];

const V1_EVIDENCE_ORIGIN_SET = new Set<string>(V1_EVIDENCE_ORIGINS);

/**
 * Projeta uma origem V2 para o vocabulário V1. `null` significa que o DTO V1 não
 * representa a origem — e nesse caso ela nunca é colapsada em outra.
 */
export function toV1EvidenceOrigin(
  origin: FoodEvidenceOrigin
): MealSemanticEvidenceOrigin | null {
  return V1_EVIDENCE_ORIGIN_SET.has(origin)
    ? (origin as MealSemanticEvidenceOrigin)
    : null;
}

/** Slots de evidência existentes no DTO V1 (`MealSemanticItem.evidence`). */
export const V1_EVIDENCE_FIELDS = [
  "identity",
  "brand",
  "variant",
  "quantity",
  "estimatedGrams",
  "nutrition",
] as const;
export type V1EvidenceField = (typeof V1_EVIDENCE_FIELDS)[number];

/** Mapeamento de caminho de evidência V2 para o slot equivalente V1. */
export const V2_EVIDENCE_FIELD_TO_V1: Record<string, V1EvidenceField> = {
  "identity.foodName": "identity",
  "identity.brand": "brand",
  "identity.variant": "variant",
  "quantity.value": "quantity",
  "quantity.grams": "estimatedGrams",
  "nutrition.basis": "nutrition",
  "nutrition.calories": "nutrition",
  "nutrition.protein": "nutrition",
  "nutrition.carbs": "nutrition",
  "nutrition.fat": "nutrition",
  "nutrition.fiber": "nutrition",
  "nutrition.sugar": "nutrition",
  "nutrition.sodiumMg": "nutrition",
  "nutrition.profileId": "nutrition",
  "nutrition.sourceId": "nutrition",
};

export const V1_PROJECTION_BLOCKERS = [
  "decision-not-resolved",
  "identity-not-representable",
  "quantity-not-representable",
  "physical-basis-not-representable",
  "nutrition-absent-not-zero",
  "nutrition-state-not-representable",
  "evidence-origin-not-representable",
  "classification-not-representable",
] as const;
export type V1ProjectionBlocker = (typeof V1_PROJECTION_BLOCKERS)[number];

/**
 * Campos exigidos pelo DTO V1 (`MealDraftItem`) que a decisão V2 não fornece sem
 * invenção. Eles são declarados explicitamente para que nenhum consumidor trate
 * a projeção como um `MealDraftItem` completo.
 */
export const V1_FIELDS_NOT_SUPPLIED = [
  "portionText",
  "servings",
  "confidence",
  "source",
] as const;

export type V1CompatibleDecisionProjection = {
  /** `true` somente quando não há blocker de fidelidade. */
  faithful: boolean;
  blockers: Array<{ code: V1ProjectionBlocker; detail: string }>;
  missingV1Fields: readonly (typeof V1_FIELDS_NOT_SUPPLIED)[number][];
  item: {
    foodName: string;
    canonicalName: string;
    brand: string | null;
    /** `identity.variant` V2 corresponde a `productVariant` no DTO V1 (§21.1). */
    productVariant: string | null;
    /** `foodEntityId` V2; nunca projetado em `foodCatalogId`. */
    foodId: number | undefined;
    quantity: number;
    unit: string;
    /** Somente relação física comprovada em gramas. */
    estimatedGrams: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  } | null;
  resolution: MealItemResolutionMetadata | null;
  classification: FoodClassificationEstimate | null;
  classificationProvisional: {
    processingLevel: FoodDecisionClassification["processingLevel"];
    isFruit: boolean | null;
    isVegetable: boolean | null;
    isUltraProcessed: boolean | null;
    provisional: boolean;
  } | null;
  evidenceOrigins: Partial<Record<V1EvidenceField, FoodEvidenceOrigin>>;
};

function collectBlockers(
  decision: FoodResolutionDecision
): Array<{ code: V1ProjectionBlocker; detail: string }> {
  const blockers: Array<{ code: V1ProjectionBlocker; detail: string }> = [];
  const identity = decision.identity;
  const quantity = decision.quantity;

  if (decision.status !== "resolved") {
    blockers.push({
      code: "decision-not-resolved",
      detail: `status=${decision.status} e nextAction=${decision.nextAction} não têm representação fiel no DTO V1; migre o consumidor antes de habilitar o caso.`,
    });
  }

  if (identity.canonicalName === null) {
    blockers.push({
      code: "identity-not-representable",
      detail:
        "Sem nome canônico não há identidade para o DTO V1; nenhuma identidade é fabricada a partir do texto bruto.",
    });
  }

  if (quantity.value === null || quantity.unit === null) {
    blockers.push({
      code: "quantity-not-representable",
      detail:
        "Quantidade V1 exige valor e unidade explícitos; ausência nunca vira zero.",
    });
  }

  if (quantity.grams === null) {
    blockers.push({
      code: "physical-basis-not-representable",
      detail:
        quantity.milliliters !== null
          ? "Base em ml não pode ser projetada em estimatedGrams sem relação física comprovada (§21.1/§5)."
          : "Sem base física em gramas comprovada o DTO V1 não pode receber estimatedGrams sem invenção.",
    });
  } else if (isVolumeUnit(quantity.unit)) {
    blockers.push({
      code: "physical-basis-not-representable",
      detail:
        "Unidade declarada é volumétrica e a projeção para gramas exigiria conversão; use a base comprovada do contrato.",
    });
  }

  if (decision.nutrition.consumed === null) {
    blockers.push({
      code: "nutrition-absent-not-zero",
      detail:
        "Nutrição ausente usa consumed=null; nunca é projetada como zeros nem como verificado.",
    });
  }

  const nutritionEvidence = decision.evidence.filter(
    evidence =>
      evidence.field.startsWith("nutrition.") &&
      V2_EVIDENCE_FIELD_TO_V1[evidence.field] === "nutrition"
  );
  if (decision.nutrition.consumed !== null && nutritionEvidence.length === 0) {
    blockers.push({
      code: "nutrition-state-not-representable",
      detail:
        "DTO V1 exige origem nutricional por campo; a decisão não traz evidência nutricional resolvível para projetar.",
    });
  }

  const nutritionOrigin = nutritionEvidence
    .map(evidence => evidence.origin)
    .find(origin => isGroundedEvidenceOrigin(origin));
  if (nutritionOrigin && toV1EvidenceOrigin(nutritionOrigin) === null) {
    blockers.push({
      code: "evidence-origin-not-representable",
      detail: `Origem de evidência ${nutritionOrigin} não existe no vocabulário V1; ela não é colapsada em outra origem.`,
    });
  }

  for (const evidence of decision.evidence) {
    if (toV1EvidenceOrigin(evidence.origin) === null) {
      blockers.push({
        code: "evidence-origin-not-representable",
        detail: `Evidência ${evidence.evidenceId} usa origem ${evidence.origin}, ausente no vocabulário V1; nenhuma origem é colapsada para se ajustar ao DTO legado.`,
      });
    }
  }

  if (decision.classification !== null) {
    blockers.push({
      code: "classification-not-representable",
      detail:
        "FoodClassificationEstimate V1 exige fiberGrams, que o contrato V2 não garante; a classificação é exposta separadamente sem inventar o valor ausente.",
    });
  }

  return blockers;
}

/**
 * Projeção V2 → DTO V1 para consumidor público ainda não migrado.
 *
 * A projeção é somente leitura, não reinfere texto, não recalcula macros e não
 * converte incompatibilidade em zeros/`verified`. Ela declara `blockers` para
 * tudo que o DTO V1 não representa fielmente.
 */
export function projectDecisionV2ToV1(
  decision: FoodResolutionDecision
): V1CompatibleDecisionProjection {
  const blockers = collectBlockers(decision);
  const identity = decision.identity;
  const quantity = decision.quantity;

  const evidenceOrigins: Partial<Record<V1EvidenceField, FoodEvidenceOrigin>> =
    {};
  for (const evidence of decision.evidence) {
    const slot = V2_EVIDENCE_FIELD_TO_V1[evidence.field];
    if (!slot) continue;
    if (!(slot in evidenceOrigins)) {
      evidenceOrigins[slot] = evidence.origin;
    }
  }

  const nutritionEvidence = decision.evidence.find(
    evidence =>
      V2_EVIDENCE_FIELD_TO_V1[evidence.field] === "nutrition" &&
      isGroundedEvidenceOrigin(evidence.origin)
  );
  const projectedNutritionOrigin = nutritionEvidence
    ? toV1EvidenceOrigin(nutritionEvidence.origin)
    : null;

  const itemRepresentable =
    decision.status === "resolved" &&
    identity.canonicalName !== null &&
    quantity.value !== null &&
    quantity.unit !== null &&
    quantity.grams !== null &&
    !isVolumeUnit(quantity.unit) &&
    decision.nutrition.consumed !== null;

  const consumed: FoodNutritionValues | null = decision.nutrition.consumed;

  const item =
    itemRepresentable && consumed
      ? {
          foodName: identity.canonicalName as string,
          canonicalName: identity.canonicalName as string,
          brand: identity.brand,
          productVariant: identity.variant,
          foodId: identity.foodEntityId ?? undefined,
          quantity: quantity.value as number,
          unit: quantity.unit as string,
          estimatedGrams: quantity.grams as number,
          calories: consumed.calories,
          protein: consumed.protein,
          carbs: consumed.carbs,
          fat: consumed.fat,
        }
      : null;

  const resolution: MealItemResolutionMetadata | null = itemRepresentable
    ? {
        productVariant: identity.variant,
        barcode: identity.barcode,
        nutritionOrigin: projectedNutritionOrigin ?? "unavailable",
        nutritionVerified: decision.nutrition.verified,
        sourceConfidence: identity.confidence ?? quantity.confidence,
        sourceVerifiedAt: null,
        measureResolution: null,
        ambiguity: null,
      }
    : null;

  const classification = decision.classification;

  return {
    faithful: blockers.length === 0,
    blockers,
    missingV1Fields: [...V1_FIELDS_NOT_SUPPLIED],
    item,
    resolution,
    classification: null,
    classificationProvisional: classification
      ? {
          processingLevel: classification.processingLevel,
          isFruit: classification.isFruit,
          isVegetable: classification.isVegetable,
          isUltraProcessed: classification.isUltraProcessed,
          provisional: classification.provisional,
        }
      : null,
    evidenceOrigins,
  };
}

/**
 * Código estável do bloqueio explícito: `MealSemanticContract` V1 é resultado
 * pós-resolução e nunca vira observação pré-resolução. Se ele fosse aceito como
 * entrada do V2, o V1 voltaria a decidir identidade — exatamente o ownership
 * concorrente que a arquitetura alvo elimina.
 */
export const V1_SEMANTIC_CONTRACT_IS_POST_RESOLUTION =
  "v1-semantic-contract-is-post-resolution" as const;

export type V1SemanticContractRejection = {
  ok: false;
  reason: typeof V1_SEMANTIC_CONTRACT_IS_POST_RESOLUTION;
  detail: string;
};

/** Detecta um `MealSemanticContract` V1 por versão declarada. */
export function isV1MealSemanticContract(
  value: unknown
): value is MealSemanticContract {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown };
  return candidate.version === MEAL_SEMANTIC_CONTRACT_VERSION;
}

/**
 * Adapter explícito e sempre recusante: `MealSemanticContract` V1 não é
 * observação pré-resolução (§21.1). O caminho correto é produzir §4 antes da
 * decisão; o V1 não é chamado para fabricar uma decisão usada como entrada do V2.
 */
export function v1SemanticContractToFoodObservations(
  contract: MealSemanticContract
): V1SemanticContractRejection {
  return {
    ok: false,
    reason: V1_SEMANTIC_CONTRACT_IS_POST_RESOLUTION,
    detail:
      `MealSemanticContract v${contract.version} é montado depois da resolução ` +
      "(server/mealSemanticContract.ts) e não representa 'o que foi observado'. " +
      "Ele não pode ser convertido em FoodObservation[] nem reutilizado como " +
      "entrada do resolvedor V2; consumidores V1 permanecem no handler compatível " +
      "identificado pelo seu contrato persistido.",
  };
}

export type HistoricalSnapshotReadResult =
  | {
      ok: true;
      contractVersion: 1 | "absent";
      snapshot: MealProcessingResult;
      reinferenceApplied: false;
      macrosRecalculated: false;
    }
  | {
      ok: false;
      reason: "unsupported-schema-version" | "invalid-snapshot";
      detail: string;
    };

/**
 * Leitura de snapshot histórico de refeição.
 *
 * O snapshot é devolvido **pela mesma referência recebida**: nenhuma
 * reinferência, nenhum recálculo de macro, nenhuma normalização e nenhum
 * backfill. Snapshot V1 é lido pela versão conhecida; ausência histórica do
 * contrato semântico não autoriza omiti-lo em nova execução.
 */
export function readHistoricalV1MealSnapshot(
  snapshot: unknown
): HistoricalSnapshotReadResult {
  if (typeof snapshot !== "object" || snapshot === null) {
    return {
      ok: false,
      reason: "invalid-snapshot",
      detail: "Snapshot histórico deve ser um objeto persistido.",
    };
  }

  const candidate = snapshot as Partial<MealProcessingResult> & {
    semanticContract?: { version?: unknown };
  };

  if (!Array.isArray(candidate.items)) {
    return {
      ok: false,
      reason: "invalid-snapshot",
      detail:
        "Snapshot histórico sem lista de itens não é legível pela versão conhecida.",
    };
  }

  const declaredVersion = candidate.semanticContract?.version;
  if (
    declaredVersion !== undefined &&
    declaredVersion !== MEAL_SEMANTIC_CONTRACT_VERSION
  ) {
    return {
      ok: false,
      reason: "unsupported-schema-version",
      detail:
        `Snapshot declara MealSemanticContract versão ${String(declaredVersion)}, ` +
        "desconhecida por este leitor. Nenhuma leitura destrutiva ou migração implícita é aplicada.",
    };
  }

  return {
    ok: true,
    contractVersion:
      declaredVersion === MEAL_SEMANTIC_CONTRACT_VERSION ? 1 : "absent",
    // Referência preservada de propósito: prova de ausência de reinferência.
    snapshot: candidate as MealProcessingResult,
    reinferenceApplied: false,
    macrosRecalculated: false,
  };
}
