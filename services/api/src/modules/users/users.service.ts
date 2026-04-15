import { prisma } from '../../shared/database/prisma';
import { cache, cacheKeys } from '../../shared/cache/redis';
import { logger } from '../../shared/logger/logger';
import type { CreateUserInput, UpdateUserGoalInput } from './users.types';
import type { User, UserGoal } from '@prisma/client';

export const usersService = {
  /**
   * Find user by phone, or create if not exists (upsert on first WhatsApp contact)
   */
  async findOrCreateByPhone(phone: string, name?: string): Promise<User> {
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      // Update name if we got it from WhatsApp
      if (name && !existing.name) {
        return prisma.user.update({
          where: { id: existing.id },
          data: { name },
        });
      }
      return existing;
    }

    logger.info({ phone }, 'Creating new user');

    const user = await prisma.user.create({
      data: {
        phone,
        name,
        // Create default goal
        goal: {
          create: {
            caloriesPerDay: 2000,
            proteinPerDay: 50,
            carbsPerDay: 250,
            fatPerDay: 65,
          },
        },
        subscription: {
          create: { plan: 'FREE', status: 'TRIAL' },
        },
      },
    });

    return user;
  },

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  async findByPhone(phone: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { phone } });
  },

  async create(input: CreateUserInput): Promise<User> {
    return prisma.user.create({
      data: {
        ...input,
        goal: { create: {} },
        subscription: { create: { plan: 'FREE', status: 'TRIAL' } },
      },
    });
  },

  async updateGoal(userId: string, input: UpdateUserGoalInput): Promise<UserGoal> {
    const goal = await prisma.userGoal.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });

    // Auto-calculate goal if biometric data provided
    if (input.heightCm && input.currentWeightKg && input.age && input.gender && input.activityLevel && input.goalType) {
      const calculated = this.calculateTDEE(input as Required<UpdateUserGoalInput>);
      await prisma.userGoal.update({
        where: { userId },
        data: { caloriesPerDay: calculated.calories },
      });
    }

    await cache.del(cacheKeys.userGoal(userId));
    return goal;
  },

  async getGoal(userId: string): Promise<UserGoal | null> {
    const cached = await cache.get<UserGoal>(cacheKeys.userGoal(userId));
    if (cached) return cached;

    const goal = await prisma.userGoal.findUnique({ where: { userId } });
    if (goal) await cache.set(cacheKeys.userGoal(userId), goal, 1800);
    return goal;
  },

  async completeOnboarding(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted: true },
    });
  },

  /**
   * Calculate Total Daily Energy Expenditure (TDEE) using Harris-Benedict equation
   */
  calculateTDEE(params: {
    gender: string;
    currentWeightKg: number;
    heightCm: number;
    age: number;
    activityLevel: string;
    goalType: string;
  }): { calories: number; protein: number; carbs: number; fat: number } {
    // Basal Metabolic Rate
    let bmr: number;
    if (params.gender === 'MALE') {
      bmr = 88.362 + 13.397 * params.currentWeightKg + 4.799 * params.heightCm - 5.677 * params.age;
    } else {
      bmr = 447.593 + 9.247 * params.currentWeightKg + 3.098 * params.heightCm - 4.330 * params.age;
    }

    const activityMultipliers: Record<string, number> = {
      SEDENTARY: 1.2,
      LIGHTLY_ACTIVE: 1.375,
      MODERATELY_ACTIVE: 1.55,
      VERY_ACTIVE: 1.725,
      EXTRA_ACTIVE: 1.9,
    };

    const tdee = bmr * (activityMultipliers[params.activityLevel] ?? 1.2);

    const goalAdjustments: Record<string, number> = {
      LOSE_WEIGHT: -500,
      MAINTAIN: 0,
      GAIN_WEIGHT: 300,
      BUILD_MUSCLE: 200,
    };

    const calories = Math.round(tdee + (goalAdjustments[params.goalType] ?? 0));

    // Macro distribution: 30% protein, 45% carbs, 25% fat
    return {
      calories,
      protein: Math.round((calories * 0.30) / 4), // 4 kcal/g
      carbs: Math.round((calories * 0.45) / 4),
      fat: Math.round((calories * 0.25) / 9), // 9 kcal/g
    };
  },
};
