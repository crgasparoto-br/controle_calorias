import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma';
import { nutritionService } from '../nutrition/nutrition.service';
import { z } from 'zod';

const listMealsQuerySchema = z.object({
  date: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  mealType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const correctMealItemSchema = z.object({
  quantity: z.number().positive().optional(),
  unit: z.string().optional(),
  calories: z.number().min(0).optional(),
  protein: z.number().min(0).optional(),
  carbs: z.number().min(0).optional(),
  fat: z.number().min(0).optional(),
});

export const mealsRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Auth hook
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  /**
   * GET /api/v1/meals
   */
  fastify.get(
    '/',
    async (request: FastifyRequest<{ Querystring: unknown }>, reply: FastifyReply) => {
      const { userId } = request.user as { userId: string };
      const parsed = listMealsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
      }

      const { date, startDate, endDate, mealType, page, limit } = parsed.data;

      const where: Record<string, unknown> = { userId };

      if (date) {
        where['date'] = {
          gte: new Date(`${date}T00:00:00.000Z`),
          lte: new Date(`${date}T23:59:59.999Z`),
        };
      } else if (startDate && endDate) {
        where['date'] = {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lte: new Date(`${endDate}T23:59:59.999Z`),
        };
      }

      if (mealType) where['mealType'] = mealType;

      const [meals, total] = await Promise.all([
        prisma.meal.findMany({
          where,
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.meal.count({ where }),
      ]);

      return reply.send({
        data: meals,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    },
  );

  /**
   * GET /api/v1/meals/:id
   */
  fastify.get(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { userId } = request.user as { userId: string };
      const meal = await prisma.meal.findFirst({
        where: { id: request.params.id, userId },
        include: { items: true },
      });

      if (!meal) return reply.status(404).send({ error: 'Meal not found' });
      return reply.send(meal);
    },
  );

  /**
   * DELETE /api/v1/meals/:id
   */
  fastify.delete(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { userId } = request.user as { userId: string };
      const meal = await prisma.meal.findFirst({
        where: { id: request.params.id, userId },
      });

      if (!meal) return reply.status(404).send({ error: 'Meal not found' });

      await prisma.meal.delete({ where: { id: request.params.id } });

      // Trigger daily summary recalculation
      const date = meal.date.toISOString().split('T')[0];
      await nutritionService.updateDailySummary(userId, date);

      return reply.status(204).send();
    },
  );

  /**
   * PATCH /api/v1/meals/:mealId/items/:itemId
   * Correct a meal item (user confirms or adjusts)
   */
  fastify.patch(
    '/:mealId/items/:itemId',
    async (
      request: FastifyRequest<{ Params: { mealId: string; itemId: string }; Body: unknown }>,
      reply: FastifyReply,
    ) => {
      const { userId } = request.user as { userId: string };

      const meal = await prisma.meal.findFirst({
        where: { id: request.params.mealId, userId },
      });
      if (!meal) return reply.status(404).send({ error: 'Meal not found' });

      const parsed = correctMealItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
      }

      const updatedItem = await prisma.mealItem.update({
        where: { id: request.params.itemId },
        data: {
          ...parsed.data,
          source: 'USER_CONFIRMED',
          confidenceScore: 1.0,
        },
      });

      // Recalculate meal totals
      const allItems = await prisma.mealItem.findMany({
        where: { mealId: request.params.mealId },
      });

      await prisma.meal.update({
        where: { id: request.params.mealId },
        data: {
          totalCalories: allItems.reduce((s, i) => s + i.calories, 0),
          totalProtein: allItems.reduce((s, i) => s + i.protein, 0),
          totalCarbs: allItems.reduce((s, i) => s + i.carbs, 0),
          totalFat: allItems.reduce((s, i) => s + i.fat, 0),
          totalFiber: allItems.reduce((s, i) => s + i.fiber, 0),
          confirmedByUser: true,
        },
      });

      const date = meal.date.toISOString().split('T')[0];
      await nutritionService.updateDailySummary(userId, date);

      return reply.send(updatedItem);
    },
  );
};
