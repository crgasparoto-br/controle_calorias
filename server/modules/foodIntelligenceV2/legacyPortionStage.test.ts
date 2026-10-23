import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { foods, foodCatalog, foodBrands, foodAliases, foodPortions, foodSources, portions } from "../../../drizzle/schema";
import {
  foodEvidence, foodVariants, foodVariantSources,
  foodNutritionProfiles, foodReviewCases,
} from "../../../drizzle/food-intelligence-v2-schema";
import { reconcileLegacyFoodKnowledge } from "./legacyReconciliationRepository";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Use the real B2 stage transaction with deterministic Drizzle table identities,
 * so a missing revision is demonstrably quarantined instead of updated. */
function installStage(portionVersion: string | null) {
  const url = "https://official.example/products/food-1?revision=v1";
  const food = {
    id: 4, name: "arroz", normalizedName: "arroz", status: "active",
    scope: "global", ownerUserId: null, brandName: null,
    canonicalKey: "food-4", sourceId: 7, sourceFoodCode: "ITEM-1",
    caloriesKcalPer100g: 130, proteinGramsPer100g: 3,
    carbsGramsPer100g: 28, fatGramsPer100g: 0.3,
  };
  const source = { id: 7, slug: "official", sourceUrl: url, version: "v1" };
  const grant = {
    sourceVersion: "v1", status: "approved", allowRead: 1,
    allowPersistEvidence: 0, allowGlobalPublication: 1,
    licenseReference: "https://official.example/license", approvalReference: "approval-1",
    approvedAt: new Date("2026-10-20T12:00:00Z"), validUntil: null,
    revokedAt: null, retentionDays: null,
  };
  const nutritionFingerprint = hash([
    food.caloriesKcalPer100g, food.proteinGramsPer100g,
    food.carbsGramsPer100g, food.fatGramsPer100g,
  ]);
  const payload = {
    table: "foods", legacyRowId: food.id, sourceId: source.id,
    sourceVersion: "v1", sourceCode: food.sourceFoodCode, nutritionFingerprint,
  };
  const evidence = {
    subjectKey: "b2:legacy:foods:4", evidenceType: "official_source",
    sourceId: 7, ownerUserId: null, sourceReference: url,
    payloadJson: JSON.stringify(payload), contentHash: hash(payload),
    capturedAt: new Date("2026-10-20T12:00:00Z"),
    retentionUntil: new Date("2026-11-20T12:00:00Z"),
  };
  const portion = {
    id: 101, foodId: 4, foodVariantId: null, sourceId: 7,
    sourceVersion: portionVersion, status: "verified", validTo: null,
    grams: 25, label: "colher", normalizedLabel: "colher", unit: "serving",
    quantity: 1,
  };
  const inventory = new Map<unknown, unknown[]>([
    [foods, [food]], [foodCatalog, []], [foodSources, [{ source, grant }]],
    [foodBrands, []], [foodAliases, []], [foodPortions, [portion]],
    [portions, []], [foodEvidence, [evidence]],
  ]);
  const select = vi.fn(() => {
    let selected: unknown;
    return {
      from(table: unknown) { selected = table; return this; },
      where() { return this; }, innerJoin() { return this; },
      leftJoin() { return this; },
      async limit() { return inventory.get(selected) ?? []; },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve(inventory.get(selected) ?? []).then(resolve, reject);
      },
    };
  });
  const updated: unknown[] = [];
  const reviews: Array<{ caseType: string; targetArtifactId: string }> = [];
  let variant: Record<string, unknown> = { id: 22, foodId: 4, revision: 1 };
  let mapping: Record<string, unknown> = { id: 33, foodVariantId: 22, sourceId: 7, status: "active" };
  let profile: Record<string, unknown> = { id: 44, foodVariantId: 22, status: "provisional" };
  const tx = {
    select() {
      let table: unknown;
      return {
        from(value: unknown) { table = value; return this; },
        where() { return this; }, innerJoin() { return this; },
        async limit() {
          if (table === foodEvidence) return [evidence];
          if (table === foodSources) return [{ source, grant }];
          if (table === foodVariants) return [variant];
          if (table === foodVariantSources) return [mapping];
          if (table === foodNutritionProfiles) return [profile];
          if (table === foodPortions) return updated.length ? [{ ...portion, foodVariantId: 22 }] : [];
          throw new Error("Unexpected B2 stage query");
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          if (table === foodVariants) variant = { ...variant, ...values };
          if (table === foodVariantSources) mapping = { ...mapping, ...values };
          if (table === foodNutritionProfiles) profile = { ...profile, ...values };
          if (table === foodReviewCases) reviews.push({
            caseType: String(values.caseType), targetArtifactId: String(values.targetArtifactId),
          });
          return { async onDuplicateKeyUpdate() {} };
        },
      };
    },
    update(table: unknown) {
      if (table !== foodPortions) throw new Error("Unexpected B2 stage update");
      return { set(values: unknown) { return {
        async where() { updated.push(values); },
      }; } };
    },
  };
  const transaction = vi.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx));
  vi.mocked(getDb).mockResolvedValue({ select, transaction } as never);
  return { updated, reviews, transaction };
}

beforeEach(() => vi.resetAllMocks());

describe("AUD-1302-033: legacy portion revision at the actual B2 stage boundary", () => {
  it.each([null, "v0"])("quarantines an unproven/older portion revision %s", async version => {
    const result = installStage(version);
    const plan = await reconcileLegacyFoodKnowledge("stage");
    expect(plan.totals).toEqual({ input: 1, mapped: 1, merged: 0, quarantined: 0 });
    expect(result.transaction).toHaveBeenCalledOnce();
    expect(result.updated).toHaveLength(0);
    expect(result.reviews).toContainEqual({
      caseType: "legacy_portion_quarantine", targetArtifactId: "101",
    });
  });

  it("retains a traceable, source-revision-matched portion in staging", async () => {
    const result = installStage("v1");
    await reconcileLegacyFoodKnowledge("stage");
    expect(result.updated).toHaveLength(1);
    expect(result.reviews).not.toContainEqual(expect.objectContaining({
      caseType: "legacy_portion_quarantine",
    }));
  });
});
