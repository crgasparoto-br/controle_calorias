import { sql, type SQL } from "drizzle-orm";
import type { FoodSearchItem } from "./catalog";
import {
  isFoodDeprecatedInMemory,
  registerDeprecatedFood,
} from "./deprecationRegistry";

type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

type TransactionalSqlExecutor = SqlExecutor & {
  transaction: <T>(
    callback: (transaction: SqlExecutor) => Promise<T>
  ) => Promise<T>;
};

type LegacyFoodRow = {
  id: number;
  name: string;
  aliases: string | null;
  status: "active" | "deprecated";
};

export class LegacyFoodNotFoundError extends Error {
  constructor() {
    super("Alimento criado pelo usuário não encontrado.");
    this.name = "LegacyFoodNotFoundError";
  }
}

export class LegacyFoodDeletePersistenceError extends Error {
  constructor() {
    super("Não foi possível excluir o alimento. Tente novamente.");
    this.name = "LegacyFoodDeletePersistenceError";
  }
}

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    const [rows] = result;
    return Array.isArray(rows) ? (rows as T[]) : (result as T[]);
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

function parseAliases(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function success(foodId: number, alreadyDeprecated: boolean) {
  return {
    success: true,
    foodId,
    status: "deprecated" as const,
    alreadyDeprecated,
  };
}

export function createLegacyFoodDeletionService(deps: {
  getDb: () => Promise<unknown>;
  searchFoods: (
    userId: number,
    query?: string,
    limit?: number
  ) => Promise<FoodSearchItem[]>;
  onWarning: (scope: string, error: unknown) => void;
}) {
  async function deleteFood(userId: number, foodId: number) {
    const db = await deps.getDb();
    if (!db) {
      if (isFoodDeprecatedInMemory(userId, foodId))
        return success(foodId, true);

      const food = (await deps.searchFoods(userId, "", 500)).find(
        item => item.id === foodId
      );
      if (!food || !food.isUserCreated || food.createdByUserId !== userId) {
        throw new LegacyFoodNotFoundError();
      }

      registerDeprecatedFood(userId, foodId, [food.name]);
      return success(foodId, false);
    }

    try {
      const transactionalDb = db as TransactionalSqlExecutor;
      if (typeof transactionalDb.transaction !== "function") {
        throw new Error("Database transaction is unavailable");
      }

      const row = await transactionalDb.transaction(async transaction => {
        const rows = extractRows<LegacyFoodRow>(
          await transaction.execute(sql`
          SELECT id, name, aliases, status
          FROM foodCatalog
          WHERE id = ${foodId}
            AND isUserCreated = 1
            AND createdByUserId = ${userId}
          LIMIT 1
          FOR UPDATE
        `)
        );
        const ownedFood = rows[0];
        if (!ownedFood) throw new LegacyFoodNotFoundError();

        if (ownedFood.status === "active") {
          await transaction.execute(sql`
            UPDATE foodCatalog
            SET status = 'deprecated', updatedAt = CURRENT_TIMESTAMP
            WHERE id = ${foodId}
              AND isUserCreated = 1
              AND createdByUserId = ${userId}
              AND status = 'active'
          `);
        }

        await transaction.execute(sql`
          DELETE FROM foodFavorites
          WHERE userId = ${userId}
            AND foodCatalogId = ${foodId}
        `);

        return ownedFood;
      });

      registerDeprecatedFood(userId, foodId, [
        row.name,
        ...parseAliases(row.aliases),
      ]);
      return success(foodId, row.status === "deprecated");
    } catch (error) {
      if (error instanceof LegacyFoodNotFoundError) throw error;
      deps.onWarning("Legacy food deletion failed", error);
      throw new LegacyFoodDeletePersistenceError();
    }
  }

  return { deleteFood };
}
