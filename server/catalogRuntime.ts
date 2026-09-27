import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { foodCatalog } from "../drizzle/schema";
import { FOOD_CATALOG_REFERENCE, type CatalogFoodReference } from "./foodCatalogReference";

let catalogDb: ReturnType<typeof drizzle> | null = null;
let catalogCache: CatalogFoodReference[] = [...FOOD_CATALOG_REFERENCE];

/**
 * The catalog is a lookup cache, not an archive.  Loading every historical or
 * user-researched row during boot made a single process allocate the complete
 * foodCatalog table before HTTP recovery could settle (issue #1061).
 */
export const CATALOG_CACHE_MAX_ROWS = 1000;

async function getCatalogDb() {
  if (!catalogDb && process.env.DATABASE_URL) {
    try {
      catalogDb = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[CatalogRuntime] Failed to connect to database:", error);
      catalogDb = null;
    }
  }

  return catalogDb;
}

function parseAliases(value: string | null) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch {
    return value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }
}

function parseSourceUrls(value: string | null) {
  return parseAliases(value);
}

export function getCatalogCache() {
  return catalogCache;
}

function mergeCatalogRows(rows: Array<Record<string, any>>) {
  const databaseRows = rows.map(row => ({
    slug: row.slug,
    name: row.name,
    aliases: parseAliases(row.aliases),
    servingLabel: row.servingLabel,
    gramsPerServing: row.gramsPerServing,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    fiber: row.fiber ?? undefined,
    processingLevel: row.processingLevel ?? undefined,
    isFruit: Boolean(row.isFruit),
    isVegetable: Boolean(row.isVegetable),
    isUltraProcessed: Boolean(row.isUltraProcessed),
    brandName: row.brandName,
    productVariant: row.productVariant,
    variants: row.productVariant ? [row.productVariant] : [],
    researchIdentityKey: row.researchIdentityKey,
    sourceUrls: parseSourceUrls(row.sourceUrls),
    sourceEvidence: row.sourceEvidence,
    sourceVerifiedAt: row.sourceVerifiedAt,
    sourceConfidence: row.sourceConfidence,
    isBrandedProduct: row.foodType === "branded",
  }));

  const bySlug = new Map<string, CatalogFoodReference>();
  for (const food of [...FOOD_CATALOG_REFERENCE, ...databaseRows]) {
    bySlug.set(food.slug, food);
  }
  return [...bySlug.values()];
}

export async function refreshCatalogCache() {
  const db = await getCatalogDb();
  if (!db) {
    catalogCache = [...FOOD_CATALOG_REFERENCE];
    return catalogCache;
  }

  try {
    const rows = await db
      .select({
        slug: foodCatalog.slug,
        name: foodCatalog.name,
        aliases: foodCatalog.aliases,
        brandName: foodCatalog.brandName,
        productVariant: foodCatalog.productVariant,
        foodType: foodCatalog.foodType,
        servingLabel: foodCatalog.servingLabel,
        gramsPerServing: foodCatalog.gramsPerServing,
        calories: foodCatalog.calories,
        protein: foodCatalog.protein,
        carbs: foodCatalog.carbs,
        fat: foodCatalog.fat,
        fiber: foodCatalog.fiber,
        processingLevel: foodCatalog.processingLevel,
        isFruit: foodCatalog.isFruit,
        isVegetable: foodCatalog.isVegetable,
        isUltraProcessed: foodCatalog.isUltraProcessed,
        researchIdentityKey: foodCatalog.researchIdentityKey,
        sourceUrls: foodCatalog.sourceUrls,
        sourceEvidence: foodCatalog.sourceEvidence,
        sourceVerifiedAt: foodCatalog.sourceVerifiedAt,
        sourceConfidence: foodCatalog.sourceConfidence,
      })
      .from(foodCatalog)
      .where(eq(foodCatalog.status, "active"))
      .orderBy(desc(foodCatalog.updatedAt), desc(foodCatalog.id))
      .limit(CATALOG_CACHE_MAX_ROWS);
    if (!rows.length) {
      catalogCache = [...FOOD_CATALOG_REFERENCE];
      return catalogCache;
    }

    catalogCache = mergeCatalogRows(rows);

    return catalogCache;
  } catch {
    catalogCache = [...FOOD_CATALOG_REFERENCE];
    return catalogCache;
  }
}
