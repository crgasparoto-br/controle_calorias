/**
 * C4/Gate 19: preserve only the classification attached to the confirmed item.
 * Never infer historical quality from the current catalog or from a food name.
 */
import { z } from "zod";
import type { FoodClassificationEstimate } from "../../nutritionEngineTypes";

/** A versioned, bounded-to-known-fields snapshot; not an accuracy attestation. */
export const confirmedMealClassificationSchema = z.object({
  processingLevel: z.enum([
    "natural_or_minimally_processed", "processed_culinary_ingredient",
    "processed", "ultra_processed",
  ]),
  isFruit: z.boolean(),
  isVegetable: z.boolean(),
  fiberGrams: z.number().finite().nonnegative(),
  isPlainWater: z.boolean().nullable().optional(),
}).strict();

const versionedClassificationSchema = confirmedMealClassificationSchema.extend({
  schemaVersion: z.literal(1),
});

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Compose with the existing nutrition/resolution JSON, never replacing those
 * fields or persisting arbitrary properties supplied with the classification.
 * undefined means not instrumented; null explicitly clears a stale value.
 */
export function mergeConfirmedMealClassification(
  snapshotJson: string | null | undefined,
  classification: FoodClassificationEstimate | null | undefined,
): string | null {
  if (classification === undefined) return snapshotJson ?? null;
  const snapshot: Record<string, unknown> = snapshotJson ? JSON.parse(snapshotJson) : {};
  if (!isJsonRecord(snapshot)) throw new TypeError("invalid-meal-food-snapshot");
  if (classification === null) {
    const { classification: _discarded, ...remaining } = snapshot;
    return Object.keys(remaining).length ? JSON.stringify(remaining) : null;
  }
  const checked = confirmedMealClassificationSchema.safeParse(classification);
  if (!checked.success) throw new TypeError("invalid-meal-classification");
  return JSON.stringify({
    ...snapshot,
    classification: { schemaVersion: 1, ...checked.data },
  });
}

/**
 * Historical rows predating versioning may already have classification. Only
 * the new schema is strict; a missing/invalid/unrecognized version stays null.
 */
export function readConfirmedMealClassification(
  snapshotJson: string | null | undefined,
): FoodClassificationEstimate | null {
  if (!snapshotJson) return null;
  try {
    const snapshot: unknown = JSON.parse(snapshotJson);
    if (!isJsonRecord(snapshot) || !isJsonRecord(snapshot.classification)) return null;
    const saved = snapshot.classification;
    if (Object.prototype.hasOwnProperty.call(saved, "schemaVersion")) {
      const checked = versionedClassificationSchema.safeParse(saved);
      if (!checked.success) return null;
      const { schemaVersion: _version, ...classification } = checked.data;
      return classification;
    }
    // Legacy snapshots had no version and may have unrelated old flags.
    const legacy = confirmedMealClassificationSchema.strip().safeParse(saved);
    return legacy.success ? legacy.data : null;
  } catch {
    return null;
  }
}
