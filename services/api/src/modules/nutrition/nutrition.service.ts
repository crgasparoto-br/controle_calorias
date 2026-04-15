import { prisma } from '../../shared/database/prisma';
import { cache, cacheKeys } from '../../shared/cache/redis';
import { logger } from '../../shared/logger/logger';
import type { ExtractedFood } from '../ai/ai.types';

export const nutritionService = {
  /**
   * Enrich extracted foods with data from the nutritional database when available
   */
  async enrichWithDatabase(foods: ExtractedFood[]): Promise<ExtractedFood[]> {
    const enriched: ExtractedFood[] = [];

    for (const food of foods) {
      const dbItem = await this.findFoodInDatabase(food.name);

      if (dbItem && food.confidenceScore >= 0.7) {
        // Calculate actual nutrition based on quantity
        const factor = food.quantity / 100; // DB values are per 100g
        enriched.push({
          ...food,
          estimatedCalories: Math.round(dbItem.calories * factor),
          protein: parseFloat((dbItem.protein * factor).toFixed(1)),
          carbs: parseFloat((dbItem.carbs * factor).toFixed(1)),
          fat: parseFloat((dbItem.fat * factor).toFixed(1)),
          fiber: parseFloat((dbItem.fiber * factor).toFixed(1)),
          confidenceScore: Math.min(food.confidenceScore + 0.1, 1.0), // boost confidence for DB match
        });

        logger.debug({ foodName: food.name, dbMatch: dbItem.name }, 'Food matched in database');
      } else {
        enriched.push(food);
      }
    }

    return enriched;
  },

  /**
   * Find a food item in the database by name (fuzzy search)
   */
  async findFoodInDatabase(name: string): Promise<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    name: string;
  } | null> {
    const normalizedName = this.normalizeName(name);

    // Check cache first
    const cacheKey = `food:${normalizedName}`;
    const cached = await cache.get<ReturnType<typeof this.findFoodInDatabase>>(cacheKey);
    if (cached !== null) return cached;

    // Exact match first
    const exact = await prisma.foodItem.findFirst({
      where: { nameNormalized: normalizedName },
    });

    if (exact) {
      await cache.set(cacheKey, exact, 3600); // 1 hour cache
      return exact;
    }

    // Fuzzy match using aliases
    const alias = await prisma.foodAlias.findFirst({
      where: { alias: { contains: normalizedName } },
      include: { foodItem: true },
    });

    if (alias) {
      await cache.set(cacheKey, alias.foodItem, 3600);
      return alias.foodItem;
    }

    // Trigram similarity search (PostgreSQL pg_trgm)
    const similar = await prisma.$queryRaw<Array<{ name: string; calories: number; protein: number; carbs: number; fat: number; fiber: number }>>`
      SELECT name, calories, protein, carbs, fat, fiber
      FROM food_items
      WHERE similarity(name_normalized, ${normalizedName}) > 0.4
      ORDER BY similarity(name_normalized, ${normalizedName}) DESC
      LIMIT 1
    `;

    const result = similar[0] ?? null;
    if (result) {
      await cache.set(cacheKey, result, 3600);
    }

    return result;
  },

  /**
   * Get or compute daily nutritional summary for a user
   */
  async getDailySummary(
    userId: string,
    date: string, // YYYY-MM-DD
  ): Promise<{
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    totalFiber: number;
    mealsCount: number;
  }> {
    const cacheKey = cacheKeys.dailySummary(userId, date);
    const cached = await cache.get<ReturnType<typeof this.getDailySummary>>(cacheKey);
    if (cached) return cached;

    const startDate = new Date(`${date}T00:00:00.000Z`);
    const endDate = new Date(`${date}T23:59:59.999Z`);

    const meals = await prisma.meal.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
    });

    const summary = {
      totalCalories: meals.reduce((s, m) => s + m.totalCalories, 0),
      totalProtein: meals.reduce((s, m) => s + m.totalProtein, 0),
      totalCarbs: meals.reduce((s, m) => s + m.totalCarbs, 0),
      totalFat: meals.reduce((s, m) => s + m.totalFat, 0),
      totalFiber: meals.reduce((s, m) => s + m.totalFiber, 0),
      mealsCount: meals.length,
    };

    await cache.set(cacheKey, summary, 300); // 5 min cache
    return summary;
  },

  /**
   * Update (or create) the precomputed DailySummary record
   */
  async updateDailySummary(userId: string, date: string): Promise<void> {
    const summary = await this.getDailySummary(userId, date);
    const goal = await prisma.userGoal.findUnique({ where: { userId } });

    await prisma.dailySummary.upsert({
      where: { userId_date: { userId, date: new Date(date) } },
      create: {
        userId,
        date: new Date(date),
        ...summary,
        goalCalories: goal?.caloriesPerDay ?? 2000,
        goalProtein: goal?.proteinPerDay ?? 50,
        goalCarbs: goal?.carbsPerDay ?? 250,
        goalFat: goal?.fatPerDay ?? 65,
      },
      update: {
        ...summary,
        goalCalories: goal?.caloriesPerDay ?? 2000,
        goalProtein: goal?.proteinPerDay ?? 50,
        goalCarbs: goal?.carbsPerDay ?? 250,
        goalFat: goal?.fatPerDay ?? 65,
      },
    });

    // Invalidate cache
    await cache.del(cacheKeys.dailySummary(userId, date));
  },

  normalizeName(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9 ]/g, ' ')    // replace special chars with space
      .replace(/\s+/g, ' ')            // collapse multiple spaces
      .trim();
  },
};
