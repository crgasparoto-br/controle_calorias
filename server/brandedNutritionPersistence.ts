import { createHash } from "node:crypto";
import { refreshCatalogCache } from "./catalogRuntime";
import { getDb } from "./db";
import type { CatalogFood } from "./nutritionEngineTypes";
import {
  createDrizzleFoodCatalogRepository,
  type FoodCatalogRepository,
  type FoodCatalogRow,
  type NutritionResearchUpsertInput,
} from "./repositories/foodCatalogRepository";
import { extractCommercialVariant } from "./commercialProductIdentity";

const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type NutritionResearchPersistence = {
  findByIdentity(foodName: string): Promise<CatalogFood | null>;
  save(foodName: string, food: CatalogFood): Promise<CatalogFood | null>;
};

export type NutritionResearchPersistenceDeps = {
  repository: FoodCatalogRepository;
  refreshCatalogCache?: () => Promise<unknown>;
  now?: () => Date;
};

function normalizeIdentityPart(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildNutritionResearchIdentityKey(
  foodName: string,
  _food?: CatalogFood
) {
  const identity = normalizeIdentityPart(foodName);
  return `nutrition-research-v1:${createHash("sha256").update(identity).digest("hex")}`;
}

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }
}

function rowToCatalogFood(row: FoodCatalogRow): CatalogFood {
  const sourceUrls = parseJsonArray(row.sourceUrls);
  return {
    slug: row.slug,
    name: row.name,
    aliases: parseJsonArray(row.aliases),
    servingLabel: row.servingLabel,
    gramsPerServing: row.gramsPerServing,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    fiber: row.fiber ?? undefined,
    brandName: row.brandName,
    productVariant: row.productVariant,
    variants: row.productVariant ? [row.productVariant] : [],
    researchIdentityKey: row.researchIdentityKey,
    sourceUrls,
    sourceEvidence: row.sourceEvidence,
    sourceVerifiedAt: row.sourceVerifiedAt,
    sourceConfidence: row.sourceConfidence,
    isBrandedProduct: row.foodType === "branded",
  };
}

function isFresh(row: FoodCatalogRow, now: Date) {
  return Boolean(
    row.sourceVerifiedAt &&
      now.getTime() - row.sourceVerifiedAt.getTime() >= 0 &&
      now.getTime() - row.sourceVerifiedAt.getTime() <= RESEARCH_TTL_MS
  );
}

export function createNutritionResearchPersistence(
  deps: NutritionResearchPersistenceDeps
): NutritionResearchPersistence {
  const now = deps.now ?? (() => new Date());
  const refresh = deps.refreshCatalogCache ?? (async () => undefined);

  return {
    async findByIdentity(foodName) {
      const identityKey = buildNutritionResearchIdentityKey(foodName);
      const candidate =
        await deps.repository.findResearchedByIdentity?.(identityKey);
      if (!candidate || !isFresh(candidate, now())) return null;
      return rowToCatalogFood(candidate);
    },

    async save(foodName, food) {
      const sourceUrls = food.sourceUrls ?? [];
      const sourceEvidence = food.sourceEvidence?.trim();
      const sourceVerifiedAt = food.sourceVerifiedAt ?? now();
      if (
        !food.brandName ||
        !sourceUrls.length ||
        !sourceEvidence ||
        !isFresh({ sourceVerifiedAt } as FoodCatalogRow, now())
      ) {
        return null;
      }

      const researchIdentityKey = buildNutritionResearchIdentityKey(
        foodName,
        food
      );
      const productVariant =
        food.productVariant ?? extractCommercialVariant(food.name);
      const input: NutritionResearchUpsertInput = {
        researchIdentityKey,
        slug: food.slug,
        name: food.name,
        aliases: JSON.stringify([
          ...new Set([
            ...food.aliases,
            ...sourceUrls.map(url => `fonte: ${url}`),
          ]),
        ]),
        brandName: food.brandName,
        productVariant,
        servingLabel: food.servingLabel,
        servingUnit: "g",
        gramsPerServing: food.gramsPerServing,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        fiber: food.fiber ?? null,
        sourceUrls: JSON.stringify(sourceUrls),
        sourceEvidence,
        sourceVerifiedAt,
        sourceConfidence: food.sourceConfidence ?? 0,
      };
      const id = await deps.repository.upsertResearchedNutrition?.(input);
      if (!id) return null;
      await refresh();
      return {
        ...food,
        productVariant,
        variants: productVariant ? [productVariant] : food.variants,
        researchIdentityKey,
      };
    },
  };
}

let defaultPersistence: NutritionResearchPersistence | null = null;

export function getDefaultNutritionResearchPersistence() {
  if (!defaultPersistence) {
    defaultPersistence = createNutritionResearchPersistence({
      repository: createDrizzleFoodCatalogRepository({
        getDb,
        onWarning: (scope, error) =>
          console.warn(`[NutritionResearch] ${scope}`, error),
      }),
      refreshCatalogCache,
    });
  }
  return defaultPersistence;
}
