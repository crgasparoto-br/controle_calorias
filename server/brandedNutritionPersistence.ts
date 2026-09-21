import { createHash } from "node:crypto";
import { refreshCatalogCache } from "./catalogRuntime";
import type { CatalogFood } from "./nutritionEngineTypes";
import {
  createDrizzleFoodCatalogRepository,
  type FoodCatalogRepository,
  type FoodCatalogRow,
  type NutritionResearchUpsertInput,
} from "./repositories/foodCatalogRepository";
import { detectKnownBrand } from "./foodBrandDetection";
import {
  extractCommercialVariant,
  isPersistedProductIdentityCompatible,
} from "./commercialProductIdentity";

const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_PERSISTED_SOURCE_CONFIDENCE = 0.72;

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

function identityTokens(value: string | null | undefined) {
  return normalizeIdentityPart(value)
    .split(/[^a-z0-9]+/g)
    .filter(token => token.length >= 2);
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

function hasUsableSourceUrls(value: string | null | undefined) {
  if (!value?.trim()) return false;

  let urls: unknown;
  try {
    urls = JSON.parse(value);
  } catch {
    urls = value.split(",").map(item => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(urls) || urls.length === 0 || urls.some(item => typeof item !== "string")) {
    return false;
  }

  return urls.every(candidate => {
    try {
      const url = new URL(candidate.trim());
      return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
      return false;
    }
  });
}

function hasUsableNutritionValues(row: {
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
}) {
  return (
    Number.isFinite(row.gramsPerServing) &&
    row.gramsPerServing > 0 &&
    [row.calories, row.protein, row.carbs, row.fat].every(
      value => Number.isFinite(value) && value >= 0,
    ) &&
    (row.fiber == null || (Number.isFinite(row.fiber) && row.fiber >= 0))
  );
}

function isUsablePersistedResearch(row: FoodCatalogRow, now: Date) {
  return (
    isFresh(row, now) &&
    hasUsableSourceUrls(row.sourceUrls) &&
    Boolean(row.sourceEvidence?.trim()) &&
    Number.isFinite(row.sourceConfidence) &&
    (row.sourceConfidence ?? 0) >= MIN_PERSISTED_SOURCE_CONFIDENCE &&
    (row.sourceConfidence ?? 0) <= 1 &&
    hasUsableNutritionValues(row)
  );
}

function matchesRequestedBrand(foodName: string, row: FoodCatalogRow) {
  const requestedBrand = detectKnownBrand(foodName);
  const candidateBrand = row.brandName?.trim() || null;
  if (!candidateBrand) return !requestedBrand;

  const requestedTokens = new Set(identityTokens(foodName));
  const candidateBrandTokens = identityTokens(candidateBrand);
  if (!candidateBrandTokens.every(token => requestedTokens.has(token))) return false;

  return (
    !requestedBrand ||
    normalizeIdentityPart(requestedBrand) === normalizeIdentityPart(candidateBrand)
  );
}

function matchesRequestedIdentity(foodName: string, row: FoodCatalogRow) {
  if (!matchesRequestedBrand(foodName, row)) return false;
  return isPersistedProductIdentityCompatible({
    foodName,
    matchedProductName: row.name,
    brandName: row.brandName,
    servingLabel: row.servingLabel,
    gramsPerServing: row.gramsPerServing,
  });
}

function candidateScore(foodName: string, row: FoodCatalogRow) {
  const requested = foodName.toLocaleLowerCase("pt-BR");
  const candidate =
    `${row.name} ${row.brandName ?? ""} ${row.productVariant ?? ""}`.toLocaleLowerCase(
      "pt-BR"
    );
  const requestedTokens = requested
    .split(/\s+/)
    .filter(token => token.length >= 3);
  const overlap = requestedTokens.filter(token =>
    candidate.includes(token)
  ).length;
  const variantBonus =
    row.productVariant &&
    requested.includes(row.productVariant.toLocaleLowerCase("pt-BR"))
      ? 10
      : 0;
  const freshness = row.sourceVerifiedAt?.getTime() ?? 0;
  return overlap + variantBonus + freshness / 1_000_000_000_000;
}

export function createNutritionResearchPersistence(
  deps: NutritionResearchPersistenceDeps
): NutritionResearchPersistence {
  const now = deps.now ?? (() => new Date());
  const refresh = deps.refreshCatalogCache ?? (async () => undefined);

  return {
    async findByIdentity(foodName) {
      const identityKey = buildNutritionResearchIdentityKey(foodName);
      const exact =
        await deps.repository.findResearchedByIdentity?.(identityKey);
      if (
        exact &&
        isUsablePersistedResearch(exact, now()) &&
        matchesRequestedIdentity(foodName, exact)
      ) {
        return rowToCatalogFood(exact);
      }

      const brandName = detectKnownBrand(foodName);
      const candidates =
        (await deps.repository.findResearchedCandidates?.({
          brandName: brandName ?? null,
          limit: 50,
        })) ?? [];
      const match = candidates
        .filter(
          candidate =>
            isUsablePersistedResearch(candidate, now()) &&
            matchesRequestedIdentity(foodName, candidate)
        )
        .sort(
          (left, right) =>
            candidateScore(foodName, right) - candidateScore(foodName, left)
        )[0];
      return match ? rowToCatalogFood(match) : null;
    },

    async save(foodName, food) {
      const sourceUrls = food.sourceUrls ?? [];
      const sourceEvidence = food.sourceEvidence?.trim();
      const sourceVerifiedAt = food.sourceVerifiedAt ?? now();
      const identityCompatible = isPersistedProductIdentityCompatible({
        foodName,
        matchedProductName: food.name,
        brandName: food.brandName ?? null,
        servingLabel: food.servingLabel,
        gramsPerServing: food.gramsPerServing,
      });
      const sourceConfidence = food.sourceConfidence ?? 0;
      const serializedSourceUrls = JSON.stringify(sourceUrls);
      if (
        !identityCompatible ||
        !hasUsableSourceUrls(serializedSourceUrls) ||
        !sourceEvidence ||
        !Number.isFinite(sourceConfidence) ||
        sourceConfidence < MIN_PERSISTED_SOURCE_CONFIDENCE ||
        sourceConfidence > 1 ||
        !isFresh({ sourceVerifiedAt } as FoodCatalogRow, now()) ||
        !hasUsableNutritionValues(food)
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
        brandName: food.brandName ?? null,
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
        sourceConfidence,
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

async function getDefaultDb() {
  try {
    const databaseModule = await import("./db");
    if (typeof databaseModule.getDb !== "function") return null;
    return await databaseModule.getDb();
  } catch (error) {
    console.warn("[NutritionResearch] database provider unavailable", error);
    return null;
  }
}

export function getDefaultNutritionResearchPersistence() {
  if (!defaultPersistence) {
    defaultPersistence = createNutritionResearchPersistence({
      repository: createDrizzleFoodCatalogRepository({
        getDb: getDefaultDb,
        onWarning: (scope, error) =>
          console.warn(`[NutritionResearch] ${scope}`, error),
      }),
      refreshCatalogCache,
    });
  }
  return defaultPersistence;
}
