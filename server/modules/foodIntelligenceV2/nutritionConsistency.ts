/** Contratos físicos/numéricos isolados para o schema de decisão V2 (§5). */
import { z } from "zod";
import {
  FOOD_QUANTITY_EPSILON,
  FOOD_MASS_UNITS,
  FOOD_VOLUME_UNITS,
  isMassUnit,
  isVolumeUnit,
  normalizeUnitToken,
} from "./contracts";
import type { FoodEvidence } from "./schemaShared";
import type { FoodResolutionDecision } from "./decisionSchemas";

/**
 * A tabela usa o vocabulário governado e obriga escala explícita para qualquer
 * unidade física nova. Não equipara serving a fatia nem infere densidade.
 */
const DECLARED_UNIT_SCALES = {
  g: { basis: "g", factor: 1 },
  grama: { basis: "g", factor: 1 },
  gramas: { basis: "g", factor: 1 },
  gram: { basis: "g", factor: 1 },
  grams: { basis: "g", factor: 1 },
  kg: { basis: "g", factor: 1000 },
  quilo: { basis: "g", factor: 1000 },
  quilos: { basis: "g", factor: 1000 },
  kilogram: { basis: "g", factor: 1000 },
  kilograms: { basis: "g", factor: 1000 },
  ml: { basis: "ml", factor: 1 },
  mililitro: { basis: "ml", factor: 1 },
  mililitros: { basis: "ml", factor: 1 },
  milliliter: { basis: "ml", factor: 1 },
  milliliters: { basis: "ml", factor: 1 },
  l: { basis: "ml", factor: 1000 },
  litro: { basis: "ml", factor: 1000 },
  litros: { basis: "ml", factor: 1000 },
  liter: { basis: "ml", factor: 1000 },
  liters: { basis: "ml", factor: 1000 },
  serving: { basis: "serving", factor: 1 },
  servings: { basis: "serving", factor: 1 },
  porcao: { basis: "serving", factor: 1 },
  porção: { basis: "serving", factor: 1 },
} as const satisfies Record<
  (typeof FOOD_MASS_UNITS)[number] | (typeof FOOD_VOLUME_UNITS)[number] | "serving" | "servings" | "porcao" | "porção",
  { basis: "g" | "ml" | "serving"; factor: number }
>;

type PhysicalBasis = "g" | "ml" | "serving";

function declaredPhysicalAmount(
  value: number | null,
  unit: string | null
): { basis: PhysicalBasis; amount: number } | null {
  if (value === null) return null;
  const mapping = (
    DECLARED_UNIT_SCALES as Readonly<
      Record<string, { basis: PhysicalBasis; factor: number }>
    >
  )[normalizeUnitToken(unit)];
  return mapping ? { basis: mapping.basis, amount: value * mapping.factor } : null;
}

/** A quantidade declarada e a resolvida devem concordar na mesma dimensão. */
export function assertDeclaredPhysicalConsistency(
  decision: FoodResolutionDecision,
  ctx: z.RefinementCtx
) {
  const { quantity } = decision;
  const declared = declaredPhysicalAmount(quantity.value, quantity.unit);
  if (!declared) return;
  const physicalByBasis = {
    g: quantity.grams,
    ml: quantity.milliliters,
    serving: null,
  } satisfies Record<PhysicalBasis, number | null>;
  const resolved = physicalByBasis[declared.basis];
  if (
    resolved !== null &&
    (!Number.isFinite(declared.amount) ||
      Math.abs(resolved - declared.amount) > FOOD_QUANTITY_EPSILON)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Quantidade física contradiz value/unit declarados na mesma dimensão; macros não podem usar massa/volume conflitante.",
      path: ["quantity"],
    });
  }
}

/** Somente uma relação física comprovável autoriza escalar nutrition.consumed. */
function comparableNutritionAmount(
  decision: FoodResolutionDecision
): number | null {
  const basis = decision.nutrition.basis;
  if (!basis) return null;
  const { quantity } = decision;
  const physicalByBasis = {
    g: quantity.grams,
    ml: quantity.milliliters,
    serving: null,
  } satisfies Record<PhysicalBasis, number | null>;
  const physical = physicalByBasis[basis.unit];
  if (physical !== null) return physical;
  const declared = declaredPhysicalAmount(quantity.value, quantity.unit);
  return declared?.basis === basis.unit ? declared.amount : null;
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
  // Sem relação física comparável, valores consumidos não são utilizáveis.
  if (amount === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "nutrition.consumed exige relação física comprovável entre quantidade e base g/ml/serving; porção ou densidade não são inferidas.",
      path: ["nutrition", "consumed"],
    });
    return;
  }

  const factor = amount / basis.quantity;
  if (!Number.isFinite(factor) || factor <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fator físico nutricional inválido; cálculo não é representável.",
      path: ["nutrition", "basis"],
    });
    return;
  }

  // Iterar sobre o contrato nutricional validado evita enumerar ou perder
  // nutrientes quando a versão do schema evoluir.
  for (const nutrient of Object.keys(basis.values) as Array<
    keyof typeof basis.values
  >) {
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
  const declared = declaredPhysicalAmount(quantity.value, quantity.unit);
  // Quantidade caseira convertida em massa/volume exige prova do valor físico.
  // A mera presença de grams ou milliliters não comprova uma conversão.
  if (decision.nutrition.consumed !== null && quantity.value !== null && !declared) {
    const converted = [
      { field: "quantity.grams", value: quantity.grams, path: "grams" },
      { field: "quantity.milliliters", value: quantity.milliliters, path: "milliliters" },
    ] as const;
    for (const { field, value, path } of converted) {
      if (
        value !== null &&
        !isProvenConversion(quantity.evidenceIds, field, value, evidenceById)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Conversão de medida caseira exige evidência verificada do valor físico; quantidade sem lastro não fundamenta macros.",
          path: ["quantity", path],
        });
      }
    }
  }
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

