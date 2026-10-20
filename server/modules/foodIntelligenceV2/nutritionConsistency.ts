/** Contratos físicos/numéricos isolados para o schema de decisão V2 (§5). */
import { z } from "zod";
import {
  FOOD_QUANTITY_EPSILON,
  isMassUnit,
  isVolumeUnit,
  normalizeUnitToken,
} from "./contracts";
import type { FoodEvidence } from "./schemaShared";
import type { FoodResolutionDecision } from "./decisionSchemas";

/**
 * A relação entre base e consumo só é demonstrável para medidas diretamente
 * compatíveis. Nunca deduz densidade, tamanho de porção nem converte fatia em g.
 */
function comparableNutritionAmount(
  decision: FoodResolutionDecision
): number | null {
  const basis = decision.nutrition.basis;
  if (!basis) return null;
  const quantity = decision.quantity;
  const unit = normalizeUnitToken(quantity.unit);
  if (basis.unit === "g") {
    return quantity.grams ?? (unit === "g" ? quantity.value : null);
  }
  if (basis.unit === "ml") {
    return quantity.milliliters ?? (unit === "ml" ? quantity.value : null);
  }
  return unit === "serving" ? quantity.value : null;
}

/** Resolução decimal do número informado (não é threshold nutricional). */
function declaredDecimalStep(value: number): number {
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const digits = mantissa.split(".")[1]?.length ?? 0;
  return 10 ** (Number(exponent) - digits);
}

/**
 * Compara a proporção sem instituir a tolerância de divergência nutricional
 * ainda OPEN na ADR §25. Usa apenas meia unidade da última casa decimal
 * informada na base e no consumo, além do erro de ponto flutuante.
 */
export function assertNutritionScaleConsistency(
  decision: FoodResolutionDecision,
  ctx: z.RefinementCtx
) {
  const { basis, consumed } = decision.nutrition;
  if (!basis || !consumed) return;

  const amount = comparableNutritionAmount(decision);
  // Sem medida diretamente comparável, o contrato não inventa conversão;
  // o harness de calibração continua responsável por avaliar esses casos.
  if (amount === null) return;

  const factor = amount / basis.quantity;
  if (!Number.isFinite(factor) || factor <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fator físico nutricional inválido; cálculo não é representável.",
      path: ["nutrition", "basis"],
    });
    return;
  }

  const nutrients = [
    "calories",
    "protein",
    "carbs",
    "fat",
    "fiber",
    "sugar",
    "sodiumMg",
  ] as const;
  for (const nutrient of nutrients) {
    const baseValue = basis.values[nutrient];
    const consumedValue = consumed[nutrient];
    if (baseValue === null || consumedValue === null) continue;

    const expected = baseValue * factor;
    const roundingBound =
      (declaredDecimalStep(baseValue) * factor +
        declaredDecimalStep(consumedValue)) /
        2 +
      Number.EPSILON *
        16 *
        Math.max(1, Math.abs(expected), Math.abs(consumedValue));
    if (
      !Number.isFinite(expected) ||
      !Number.isFinite(roundingBound) ||
      Math.abs(consumedValue - expected) > roundingBound
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `nutrition.consumed.${nutrient} diverge da proporção da base e quantidade comprovada; não é simples arredondamento decimal.`,
        path: ["nutrition", "consumed", nutrient],
      });
    }
  }
}

export function assertPhysicalBasisProvenance(
  decision: FoodResolutionDecision,
  evidenceById: Map<string, FoodEvidence>,
  ctx: z.RefinementCtx
) {
  const quantity = decision.quantity;
  const basisUnit = decision.nutrition.basis?.unit ?? null;
  const claimVolumeToMass =
    quantity.grams !== null &&
    (isVolumeUnit(quantity.unit) ||
      quantity.milliliters !== null ||
      basisUnit === "ml");
  const claimMassToVolume =
    quantity.milliliters !== null &&
    (isMassUnit(quantity.unit) || basisUnit === "g");
  if (
    basisUnit === "ml" &&
    quantity.grams !== null &&
    quantity.milliliters === null &&
    !isVolumeUnit(quantity.unit)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Base nutricional em ml exige unidade de volume quando somente gramas estão presentes; a relação física ml↔g não pode ser inferida.",
      path: ["nutrition", "basis", "unit"],
    });
  }
  if (
    basisUnit === "g" &&
    quantity.milliliters !== null &&
    quantity.grams === null &&
    !isMassUnit(quantity.unit)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Base nutricional em g exige unidade de massa quando somente mililitros estão presentes; a relação física ml↔g não pode ser inferida.",
      path: ["nutrition", "basis", "unit"],
    });
  }
  if (claimVolumeToMass) {
    if (
      !isProvenConversion(
        quantity.evidenceIds,
        "quantity.grams",
        quantity.grams,
        evidenceById
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Conversão de volume (ml) para massa (g) exige relação comprovada por evidência verificada; sem densidade comprovada ml não vira gramas.",
        path: ["quantity", "grams"],
      });
    }
  }
  if (claimMassToVolume) {
    if (
      !isProvenConversion(
        quantity.evidenceIds,
        "quantity.milliliters",
        quantity.milliliters,
        evidenceById
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Conversão de massa (g) para volume (ml) exige relação comprovada por evidência verificada.",
        path: ["quantity", "milliliters"],
      });
    }
  }
}
function isProvenConversion(
  evidenceIds: readonly string[],
  field: "quantity.grams" | "quantity.milliliters",
  expected: number | null,
  evidenceById: Map<string, FoodEvidence>
): boolean {
  if (expected === null) return true;
  return evidenceIds.some(evidenceId => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) return false;
    if (evidence.field !== field) return false;
    if (evidence.verified !== true) return false;
    const expectedUnit = field === "quantity.grams" ? "g" : "ml";
    if (evidence.unit !== expectedUnit) return false;
    return (
      typeof evidence.value === "number" &&
      Math.abs(evidence.value - expected) <= FOOD_QUANTITY_EPSILON
    );
  });
}

