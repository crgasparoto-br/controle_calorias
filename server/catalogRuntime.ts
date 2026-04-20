import { drizzle } from "drizzle-orm/mysql2";
import { foodCatalog } from "../drizzle/schema";
import { FOOD_CATALOG_REFERENCE, type CatalogFoodReference } from "./foodCatalogReference";

let catalogDb: ReturnType<typeof drizzle> | null = null;
let catalogCache: CatalogFoodReference[] = [...FOOD_CATALOG_REFERENCE];

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

export function getCatalogCache() {
  return catalogCache;
}

export async function refreshCatalogCache() {
  const db = await getCatalogDb();
  if (!db) {
    catalogCache = [...FOOD_CATALOG_REFERENCE];
    return catalogCache;
  }

  try {
    const rows = await db.select().from(foodCatalog);
    if (!rows.length) {
      catalogCache = [...FOOD_CATALOG_REFERENCE];
      return catalogCache;
    }

    catalogCache = rows.map(row => ({
      slug: row.slug,
      name: row.name,
      aliases: parseAliases(row.aliases),
      servingLabel: row.servingLabel,
      gramsPerServing: row.gramsPerServing,
      calories: row.calories,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
    }));

    return catalogCache;
  } catch {
    catalogCache = [...FOOD_CATALOG_REFERENCE];
    return catalogCache;
  }
}
