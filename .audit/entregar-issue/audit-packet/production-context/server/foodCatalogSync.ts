import { eq } from "drizzle-orm";
import { foodCatalog } from "../drizzle/schema";
import { getDb } from "./db";
import { FOOD_CATALOG_REFERENCE, type CatalogFoodReference } from "./foodCatalogReference";
import { refreshCatalogCache } from "./catalogRuntime";

function buildFoodCatalogValues(item: CatalogFoodReference) {
  return {
    name: item.name,
    aliases: JSON.stringify(item.aliases),
    brandName: item.brandName ?? null,
    foodType: item.isBrandedProduct ? "branded" as const : "generic" as const,
    servingLabel: item.servingLabel,
    gramsPerServing: item.gramsPerServing,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    fiber: item.fiber ?? null,
    isFruit: item.isFruit ? 1 : 0,
    isVegetable: item.isVegetable ? 1 : 0,
    isUltraProcessed: item.isUltraProcessed ? 1 : 0,
  };
}

export async function syncFoodCatalogReference() {
  const db = await getDb();
  if (!db) {
    return { inserted: 0, updated: 0, skipped: FOOD_CATALOG_REFERENCE.length };
  }

  let inserted = 0;
  let updated = 0;

  for (const item of FOOD_CATALOG_REFERENCE) {
    const existing = await db.select().from(foodCatalog).where(eq(foodCatalog.slug, item.slug)).limit(1);

    if (existing.length) {
      await db
        .update(foodCatalog)
        .set(buildFoodCatalogValues(item))
        .where(eq(foodCatalog.slug, item.slug));
      updated += 1;
    } else {
      await db.insert(foodCatalog).values({
        slug: item.slug,
        ...buildFoodCatalogValues(item),
      });
      inserted += 1;
    }
  }

  await refreshCatalogCache();

  return {
    inserted,
    updated,
    skipped: 0,
  };
}
