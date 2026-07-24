import { findCatalogFood as findCanonicalCatalogFood } from "../../../catalogMatching";
import type { CatalogFood } from "../../../nutritionEngine";

/**
 * O WhatsApp usa exatamente o mesmo ranking e o mesmo guard semântico do motor
 * nutricional. Manter um matcher local faria adição e substituição divergirem do
 * registro inicial.
 */
export function findCatalogFood(foodName: string, userId?: number): CatalogFood | null {
  return findCanonicalCatalogFood(foodName, userId) ?? null;
}
