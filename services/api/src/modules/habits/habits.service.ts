import { prisma } from '../../shared/database/prisma';
import { cache, cacheKeys } from '../../shared/cache/redis';
import { embeddingService } from '../ai/embedding.service';
import { HabitType } from '@prisma/client';
import type { FoodExtractionResult } from '../ai/ai.types';

export const habitsService = {
  /**
   * Record meal habits from a processed extraction
   */
  async recordMealHabits(
    userId: string,
    extraction: FoodExtractionResult,
    timestamp: Date,
  ): Promise<void> {
    // Record frequent foods
    for (const food of extraction.foods) {
      const existing = await prisma.userHabit.findFirst({
        where: {
          userId,
          habitType: HabitType.FREQUENT_FOOD,
          data: { path: ['name'], equals: food.name },
        },
      });

      if (existing) {
        await prisma.userHabit.update({
          where: { id: existing.id },
          data: {
            frequency: { increment: 1 },
            lastSeenAt: timestamp,
            data: {
              name: food.name,
              unit: food.unit,
              typicalQuantity: food.quantity,
              mealType: extraction.mealType,
            },
          },
        });
      } else {
        await prisma.userHabit.create({
          data: {
            userId,
            habitType: HabitType.FREQUENT_FOOD,
            data: {
              name: food.name,
              unit: food.unit,
              typicalQuantity: food.quantity,
              mealType: extraction.mealType,
            },
            frequency: 1,
            lastSeenAt: timestamp,
          },
        });
      }
    }

    // Record meal time pattern
    const hour = timestamp.getHours();
    await prisma.userHabit.create({
      data: {
        userId,
        habitType: HabitType.MEAL_PATTERN,
        data: {
          mealType: extraction.mealType,
          hour,
          dayOfWeek: timestamp.getDay(),
        },
        frequency: 1,
        lastSeenAt: timestamp,
      },
    });

    // Invalidate habits cache
    await cache.del(cacheKeys.userHabits(userId));
  },

  /**
   * Check if a message matches a named meal pattern (e.g., "meu café da manhã de sempre")
   * Uses semantic similarity
   */
  async checkNamedMealPattern(
    userId: string,
    message: string,
  ): Promise<FoodExtractionResult | null> {
    const NAMED_MEAL_PHRASES = [
      'de sempre', 'normal', 'habitual', 'meu café', 'meu almoço',
      'meu jantar', 'rotina', 'como sempre',
    ];

    const isNamedMeal = NAMED_MEAL_PHRASES.some((phrase) =>
      message.toLowerCase().includes(phrase),
    );

    if (!isNamedMeal) return null;

    const match = await embeddingService.findNamedMeal(userId, message);

    if (!match || !match.metadata) return null;

    // The metadata should contain a saved FoodExtractionResult
    const metadata = match.metadata as Record<string, unknown>;
    if (!metadata.extraction) return null;

    return metadata.extraction as FoodExtractionResult;
  },

  /**
   * Save a named meal pattern for a user
   */
  async saveNamedMeal(
    userId: string,
    description: string,
    extraction: FoodExtractionResult,
  ): Promise<void> {
    await embeddingService.storeUserEmbedding(
      userId,
      description,
      'NAMED_MEAL',
      { extraction },
    );

    await prisma.userHabit.create({
      data: {
        userId,
        habitType: HabitType.NAMED_MEAL,
        data: {
          description,
          extraction,
        },
        frequency: 1,
      },
    });
  },

  /**
   * Get user's top frequent foods
   */
  async getFrequentFoods(
    userId: string,
    limit = 10,
  ): Promise<Array<{ name: string; frequency: number }>> {
    const habits = await prisma.userHabit.findMany({
      where: { userId, habitType: HabitType.FREQUENT_FOOD },
      orderBy: { frequency: 'desc' },
      take: limit,
    });

    return habits.map((h) => ({
      name: (h.data as Record<string, unknown>)['name'] as string,
      frequency: h.frequency,
    }));
  },
};
