import { TRPCError } from "@trpc/server";
import {
  createUserFood,
  listRecentFoods,
  searchFoods,
  updateUserFood,
  upsertFavoriteFood,
} from "../../db";
import type { FoodFormInput } from "./schemas";

export function searchFoodCatalog(userId: number, input: { query?: string; limit?: number }) {
  return searchFoods(userId, input.query ?? "", input.limit ?? 20);
}

export function listRecentlyUsedFoods(userId: number) {
  return listRecentFoods(userId);
}

export function setFoodFavorite(userId: number, input: { foodId: number; favorite: boolean }) {
  return upsertFavoriteFood(userId, input.foodId, input.favorite);
}

export function createFood(userId: number, input: FoodFormInput) {
  return createUserFood(userId, input);
}

export async function updateFood(userId: number, input: FoodFormInput & { foodId: number }) {
  try {
    return await updateUserFood(userId, input);
  } catch (error) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Alimento não encontrado.",
    });
  }
}
