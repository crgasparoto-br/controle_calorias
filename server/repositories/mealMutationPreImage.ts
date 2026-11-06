import { and, asc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mealItems, meals } from "../../drizzle/schema";
import { isSha256MutationToken } from "../modules/persistenceTokens";

function normalizePersistedValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizePersistedValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map(key => [key, normalizePersistedValue(record[key])])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value === undefined ? null : value;
}

export function createMealMutationPreImage(
  mealRow: unknown,
  itemRows: unknown[]
) {
  const stable = normalizePersistedValue({
    meal: mealRow,
    items: [...itemRows].sort(
      (left: any, right: any) => Number(left.id) - Number(right.id)
    ),
  });
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function groupRawMealItemsByMealId<T extends { mealId: number }>(
  rows: T[]
) {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const items = grouped.get(row.mealId) ?? [];
    items.push(row);
    grouped.set(row.mealId, items);
  }
  return grouped;
}

type MealUpdate = {
  meal: {
    id: number;
    userId: number;
    mealLabel: string;
    notes?: string;
    confidence: number;
    occurredAt: number;
  };
  items: any[];
  resolvedCatalogIds: Map<string, number>;
};

type PersistMealUpdateWithPreImageInput = MealUpdate & {
  db: any | null;
  expectedPreImage?: string;
  runInTransaction: <T>(db: any, fn: (tx: any) => Promise<T>) => Promise<T>;
  lockMealAndItems: (
    tx: any,
    userId: number,
    mealId: number
  ) => Promise<{ meal: any; items: any[] } | null>;
  replaceMealItemsInTransaction: (
    tx: any,
    input: MealUpdate,
    previous: any[]
  ) => Promise<void>;
};

export async function persistMealUpdateWithPreImage(
  input: PersistMealUpdateWithPreImageInput
): Promise<string | void> {
  const { db, meal, items, resolvedCatalogIds, expectedPreImage } = input;
  const hasExpectedPreImage = expectedPreImage !== undefined;
  if (!db) {
    if (hasExpectedPreImage)
      throw new Error("Persisted meal CAS is unavailable.");
    return;
  }
  if (hasExpectedPreImage && typeof db.transaction !== "function") {
    throw new Error(
      "Meal batch mutation requires transactional persistence CAS."
    );
  }
  if (hasExpectedPreImage && !isSha256MutationToken(expectedPreImage)) {
    throw new Error("Invalid persisted meal pre-image token.");
  }

  return input.runInTransaction(db, async tx => {
    const locked = await input.lockMealAndItems(tx, meal.userId, meal.id);
    if (!locked) {
      if (hasExpectedPreImage)
        throw new Error("Meal changed or disappeared before CAS.");
      return;
    }
    if (
      hasExpectedPreImage &&
      createMealMutationPreImage(locked.meal, locked.items) !== expectedPreImage
    ) {
      throw new Error("Meal pre-image changed before CAS.");
    }
    await input.replaceMealItemsInTransaction(
      tx,
      { meal, items, resolvedCatalogIds },
      locked.items
    );
    if (!hasExpectedPreImage) return;

    const [updatedMeal] = await tx
      .select()
      .from(meals)
      .where(and(eq(meals.userId, meal.userId), eq(meals.id, meal.id)))
      .limit(1);
    if (!updatedMeal) throw new Error("Meal disappeared after CAS update.");
    const updatedItems = await tx
      .select()
      .from(mealItems)
      .where(eq(mealItems.mealId, meal.id))
      .orderBy(asc(mealItems.id));
    return createMealMutationPreImage(updatedMeal, updatedItems);
  });
}
