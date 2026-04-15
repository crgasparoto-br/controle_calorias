import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { usersService } from './users.service';
import { nutritionService } from '../nutrition/nutrition.service';
import { updateUserGoalSchema } from './users.types';
import { habitsService } from '../habits/habits.service';

export const usersRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Auth hook - verify JWT for all routes in this plugin
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  /**
   * GET /api/v1/users/me
   */
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const user = await usersService.findById(userId);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    const goal = await usersService.getGoal(userId);
    return reply.send({ user, goal });
  });

  /**
   * PUT /api/v1/users/me/goal
   */
  fastify.put(
    '/me/goal',
    async (
      request: FastifyRequest<{ Body: unknown }>,
      reply: FastifyReply,
    ) => {
      const { userId } = request.user as { userId: string };

      const parsed = updateUserGoalSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          details: parsed.error.issues,
        });
      }

      const goal = await usersService.updateGoal(userId, parsed.data);
      return reply.send({ goal });
    },
  );

  /**
   * GET /api/v1/users/me/summary
   * Get today's nutritional summary
   */
  fastify.get(
    '/me/summary',
    async (
      request: FastifyRequest<{ Querystring: { date?: string } }>,
      reply: FastifyReply,
    ) => {
      const { userId } = request.user as { userId: string };
      const date = request.query.date ?? new Date().toISOString().split('T')[0];

      const [summary, goal, habits] = await Promise.all([
        nutritionService.getDailySummary(userId, date),
        usersService.getGoal(userId),
        habitsService.getFrequentFoods(userId, 5),
      ]);

      return reply.send({
        date,
        summary,
        goal,
        frequentFoods: habits,
        progress: goal
          ? {
              calories: Math.round((summary.totalCalories / goal.caloriesPerDay) * 100),
              protein: Math.round((summary.totalProtein / goal.proteinPerDay) * 100),
              carbs: Math.round((summary.totalCarbs / goal.carbsPerDay) * 100),
              fat: Math.round((summary.totalFat / goal.fatPerDay) * 100),
            }
          : null,
      });
    },
  );
};
