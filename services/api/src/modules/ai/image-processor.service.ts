import OpenAI from 'openai';
import { openaiClient } from './openai.client';
import { config } from '../../config';
import { logger } from '../../shared/logger/logger';
import { aiProcessingDuration } from '../../shared/metrics/metrics';
import { foodExtractionResultSchema } from './ai.types';
import type { FoodExtractionResult } from './ai.types';

export const imageProcessorService = {
  /**
   * Analyze a food image using GPT-4o Vision and extract nutritional data
   */
  async processImage(
    imageBase64: string,
    mimeType: string,
    caption: string | undefined,
    userId: string,
    timestamp: Date = new Date(),
  ): Promise<FoodExtractionResult> {
    const end = aiProcessingDuration.startTimer({ operation: 'image_analysis', model: config.openaiModelVision });

    try {
      const systemPrompt = `Você é um especialista em nutrição e análise de imagens de alimentos.
      
Analise a imagem enviada pelo usuário e identifique todos os alimentos visíveis.
Estime as quantidades com base no que é visível no prato/imagem.

Retorne APENAS um JSON válido com o seguinte formato:
{
  "foods": [
    {
      "name": "nome do alimento em português",
      "quantity": número,
      "unit": "g|ml|unidade|fatia|porção",
      "estimatedCalories": número,
      "protein": número (gramas),
      "carbs": número (gramas),
      "fat": número (gramas),
      "fiber": número (gramas),
      "confidenceScore": 0.0-1.0
    }
  ],
  "mealType": "BREAKFAST|MORNING_SNACK|LUNCH|AFTERNOON_SNACK|DINNER|EVENING_SNACK|OTHER",
  "needsConfirmation": boolean,
  "confirmationMessage": "mensagem para confirmação se necessário"
}

Regras:
- Se for rótulo de alimento, use os valores do rótulo
- Se for prato de comida, estime visualmente
- Seja conservador nas estimativas de quantidade
- confidenceScore < 0.7 para estimativas incertas`;

      const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${imageBase64}`,
            detail: 'high',
          },
        },
      ];

      if (caption) {
        userContent.unshift({
          type: 'text',
          text: `Legenda do usuário: "${caption}"\nHora: ${timestamp.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        });
      }

      const response = await openaiClient.chat.completions.create({
        model: config.openaiModelVision,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from OpenAI vision');

      const parsed = JSON.parse(content);
      const validated = foodExtractionResultSchema.safeParse(parsed);

      if (!validated.success) {
        logger.warn({ errors: validated.error.issues }, 'Invalid image extraction response');
        throw new Error('Invalid image extraction response format');
      }

      logger.info(
        { userId, foodsFound: validated.data.foods.length },
        'Image food extraction completed',
      );

      return validated.data;
    } finally {
      end();
    }
  },
};
