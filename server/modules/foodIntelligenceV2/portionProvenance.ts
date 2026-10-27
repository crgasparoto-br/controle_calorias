/** Immutable provenance of a governed household measure, not a food catalog. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import { FOOD_MEASURE_KINDS, FOOD_QUANTITY_EPSILON } from "./contracts";
import { confidence, isValidIsoInstant, nonEmptyText, nullablePositiveInt,
  nullableText, positiveInt } from "./schemaShared";
import { isValidHttpsSourceReference } from "./sourceGrants";
import type { FoodResolutionDecision } from "./decisionSchemas";

const instant = z.string().refine(isValidIsoInstant);
export const foodPortionSnapshotSchema = z.strictObject({
  portionId: positiveInt,
  foodEntityId: positiveInt,
  variantId: positiveInt,
  label: nonEmptyText.max(120),
  unit: nonEmptyText.max(40),
  quantity: z.number().finite().positive(),
  grams: z.number().finite().positive(),
  measureKind: z.enum(FOOD_MEASURE_KINDS),
  confidence,
  sourceId: positiveInt,
  sourceVersion: nonEmptyText.max(80),
  sourceReference: nonEmptyText.max(500).refine(isValidHttpsSourceReference),
  sourcePortionCode: nullableText(120),
  evidenceId: nullablePositiveInt,
  status: z.enum(["verified", "provisional"]),
  validFrom: instant.nullable(),
  validTo: instant.nullable(),
  updatedAt: instant,
});
export type GovernedFoodPortion = z.infer<typeof foodPortionSnapshotSchema>;

/** A source revision alone is insufficient: the row may change within it. */
export function portionEvidenceReference(portion: GovernedFoodPortion): string {
  const canonical = foodPortionSnapshotSchema.parse(portion);
  return "food-portion:" + canonical.portionId + ":" +
    createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function isCurrentPortion(portion: GovernedFoodPortion, now: Date): boolean {
  const time = now.getTime();
  return Number.isFinite(time) && portion.status === "verified" &&
    (portion.validFrom === null || Date.parse(portion.validFrom) <= time) &&
    (portion.validTo === null || time < Date.parse(portion.validTo));
}

/** Validate the binding at the public decision boundary, not just at selection. */
export function assertGovernedPortionConsistency(
  decision: FoodResolutionDecision, ctx: z.RefinementCtx,
): void {
  const q = decision.quantity;
  const p = q.portionSnapshot;
  if (q.source !== "governed_portion" && p == null) return;
  const reject = () => ctx.addIssue({ code: "custom", path: ["quantity", "portionSnapshot"],
    message: "Governed portion conversion requires the same variant, source revision, measure and bound evidence." });
  if (!p || q.source !== "governed_portion" || p.status !== "verified" ||
      p.portionId !== q.portionId || p.variantId !== decision.identity.variantId ||
      p.foodEntityId !== decision.identity.foodEntityId || q.value === null || q.unit === null ||
      q.grams === null || q.milliliters !== null || q.measureKind !== p.measureKind ||
      q.confidence !== p.confidence || ![p.unit, p.label].some(value =>
        normalizeFoodName(value) === normalizeFoodName(q.unit ?? ""))) {
    reject(); return;
  }
  const expected = q.value * p.grams / p.quantity;
  if (!Number.isFinite(expected) || Math.abs(expected - q.grams) > FOOD_QUANTITY_EPSILON) {
    reject(); return;
  }
  const ids = new Set(q.evidenceIds);
  const reference = portionEvidenceReference(p);
  for (const [field, value, unit] of [
    ["quantity.portionId", p.portionId, null], ["quantity.grams", q.grams, "g"],
  ] as const) {
    if (!decision.evidence.some(item => ids.has(item.evidenceId) && item.field === field &&
        item.value === value && item.unit === unit && item.sourceId === p.sourceId &&
        item.origin === "catalog" && item.verified && item.anchor.sourceRef === reference &&
        item.anchor.span === null && item.anchor.region === null)) reject();
  }
}

/** Only conversion-derived claims depend on the selected variant. */
export function portionConversionEvidenceIds(
  quantity: FoodResolutionDecision["quantity"], evidence: FoodResolutionDecision["evidence"],
): Set<string> {
  if (quantity.source !== "governed_portion") return new Set();
  const bound = new Set(quantity.evidenceIds);
  return new Set(evidence.filter(item => bound.has(item.evidenceId) && item.origin === "catalog" &&
    (item.field === "quantity.grams" || item.field === "quantity.portionId")).map(item => item.evidenceId));
}
