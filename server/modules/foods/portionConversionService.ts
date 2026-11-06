import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../../db";

type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

type CatalogFoodPortionConversionRow = {
  id: number;
  foodId: number;
  label: string;
  unit: string;
  quantity: number;
  grams: number;
  foodVariantId: number | null;
  isDefault: number;
};

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

async function getCatalogDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Banco de dados indisponível para consulta do catálogo.",
    });
  }
  return db as unknown as SqlExecutor;
}

export function calculatePortionGrams(params: {
  portionGrams: number;
  portionQuantity: number;
  requestedQuantity: number;
}) {
  const baseQuantity = params.portionQuantity > 0 ? params.portionQuantity : 1;
  return (
    Math.round(
      ((params.portionGrams * params.requestedQuantity) / baseQuantity) * 100
    ) / 100
  );
}

export async function convertFoodPortionToGrams(
  userId: number,
  input: {
    foodId: number;
    portionId: number;
    quantity: number;
    foodVariantId?: number | null;
  }
) {
  const db = await getCatalogDb();
  const rows = extractRows<CatalogFoodPortionConversionRow>(
    await db.execute(sql`
    SELECT
      fp.id AS id,
      fp.food_id AS foodId,
      fp.label AS label,
      fp.unit AS unit,
      fp.quantity AS quantity,
      fp.grams AS grams,
      fp.food_variant_id AS foodVariantId,
      fp.is_default AS isDefault
    FROM food_portions fp
    INNER JOIN foods f ON f.id = fp.food_id
    WHERE fp.id = ${input.portionId}
      AND fp.food_id = ${input.foodId}
      AND (${
        input.foodVariantId === undefined
          ? sql`1 = 1`
          : input.foodVariantId === null
            ? sql`fp.food_variant_id IS NULL`
            : sql`fp.food_variant_id = ${input.foodVariantId}`
      })
      AND (f.owner_user_id IS NULL OR f.owner_user_id = ${userId})
    LIMIT 1
  `)
  );

  const portion = rows[0];
  if (!portion) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Porção não encontrada para este alimento.",
    });
  }

  return {
    portionId: portion.id,
    foodId: portion.foodId,
    foodVariantId: portion.foodVariantId ?? null,
    label: portion.label,
    unit: portion.unit,
    quantity: input.quantity,
    baseQuantity: portion.quantity,
    baseGrams: portion.grams,
    grams: calculatePortionGrams({
      portionGrams: portion.grams,
      portionQuantity: portion.quantity,
      requestedQuantity: input.quantity,
    }),
  };
}
