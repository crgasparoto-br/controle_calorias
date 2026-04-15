import { openaiClient } from './openai.client';
import { config } from '../../config';
import { logger } from '../../shared/logger/logger';
import { aiProcessingDuration } from '../../shared/metrics/metrics';
import { foodExtractionResultSchema } from './ai.types';
import type { FoodExtractionResult } from './ai.types';
import { prisma } from '../../shared/database/prisma';

const EXTRACTION_PROMPT_NAME = 'food-extraction';

async function getActivePrompt(name: string): Promise<string> {
  const prompt = await prisma.promptVersion.findFirst({
    where: { name, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!prompt) {
    throw new Error(`No active prompt found for: ${name}`);
  }

  return prompt.content;
}

export const textProcessorService = {
  /**
   * Extract food items from free-form text using GPT-4o
   */
  async extractFoodsFromText(
    text: string,
    userId: string,
    timestamp: Date = new Date(),
  ): Promise<FoodExtractionResult> {
    const end = aiProcessingDuration.startTimer({ operation: 'text_extraction', model: config.openaiModelChat });

    try {
      const systemPrompt = await getActivePrompt(EXTRACTION_PROMPT_NAME);

      // Get user habits for context
      const habits = await prisma.userHabit.findMany({
        where: { userId },
        orderBy: { frequency: 'desc' },
        take: 10,
      });

      const habitContext = habits.length > 0
        ? `\n\nHábitos do usuário: ${JSON.stringify(habits.map((h) => h.data).slice(0, 5))}`
        : '';

      const userMessage = `Hora da mensagem: ${timestamp.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
      
Mensagem do usuário: "${text}"${habitContext}`;

      const response = await openaiClient.chat.completions.create({
        model: config.openaiModelChat,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from OpenAI');

      const parsed = JSON.parse(content);
      const validated = foodExtractionResultSchema.safeParse(parsed);

      if (!validated.success) {
        logger.warn({ errors: validated.error.issues, parsed }, 'Invalid food extraction response');
        throw new Error('Invalid food extraction response format');
      }

      logger.info(
        { userId, foodsFound: validated.data.foods.length, mealType: validated.data.mealType },
        'Food extraction completed',
      );

      return validated.data;
    } finally {
      end();
    }
  },

  /**
   * Generate a nutritional feedback response for the user
   */
  async generateFeedbackMessage(params: {
    userId: string;
    mealSummary: string;
    consumedToday: { calories: number; protein: number; carbs: number; fat: number };
    goal: { calories: number; protein: number; carbs: number; fat: number };
  }): Promise<string> {
    const remaining = {
      calories: params.goal.calories - params.consumedToday.calories,
      protein: params.goal.protein - params.consumedToday.protein,
      carbs: params.goal.carbs - params.consumedToday.carbs,
      fat: params.goal.fat - params.consumedToday.fat,
    };

    const progressBar = (consumed: number, goal: number): string => {
      const pct = Math.min(Math.round((consumed / goal) * 100), 100);
      const filled = Math.round(pct / 10);
      return `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${pct}%`;
    };

    const response = await openaiClient.chat.completions.create({
      model: config.openaiModelChat,
      messages: [
        {
          role: 'system',
          content:
            'Você é um assistente nutricional amigável. Responda sempre em português do Brasil. ' +
            'Seja conciso (máximo 8 linhas), use emojis e seja motivador.',
        },
        {
          role: 'user',
          content: `Refeição registrada: ${params.mealSummary}

Progresso de hoje:
🔥 Calorias: ${progressBar(params.consumedToday.calories, params.goal.calories)} (${params.consumedToday.calories}/${params.goal.calories} kcal)
💪 Proteínas: ${params.consumedToday.protein.toFixed(0)}g / ${params.goal.protein}g
🍞 Carboidratos: ${params.consumedToday.carbs.toFixed(0)}g / ${params.goal.carbs}g
🥑 Gorduras: ${params.consumedToday.fat.toFixed(0)}g / ${params.goal.fat}g

Saldo restante: ${remaining.calories > 0 ? remaining.calories.toFixed(0) + ' kcal restantes' : Math.abs(remaining.calories).toFixed(0) + ' kcal acima da meta ⚠️'}

Gere uma resposta motivadora e inclua uma dica nutricional curta.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    return response.choices[0]?.message?.content ?? '✅ Refeição registrada com sucesso!';
  },
};
