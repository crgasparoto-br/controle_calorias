import { prisma } from '../../shared/database/prisma';
import { logger } from '../../shared/logger/logger';
import { sendWhatsAppQueue, updateDailySummaryQueue, generateEmbeddingQueue } from '../../shared/queue/queue';
import { textProcessorService } from './text-processor.service';
import { audioProcessorService } from './audio-processor.service';
import { imageProcessorService } from './image-processor.service';
import { nutritionService } from '../nutrition/nutrition.service';
import { habitsService } from '../habits/habits.service';
import { whatsappApiClient } from '../whatsapp/whatsapp-api.client';
import { ProcessingStatus, MealType, NutritionSource } from '@prisma/client';
import type { FoodExtractionResult } from './ai.types';

export const aiProcessorService = {
  /**
   * Main entry point: process a message log entry
   */
  async processMessage(messageLogId: string, userId: string, mediaType: string): Promise<void> {
    const startTime = Date.now();

    // Update status to processing
    await prisma.messageLog.update({
      where: { id: messageLogId },
      data: { processingStatus: ProcessingStatus.PROCESSING },
    });

    try {
      const messageLog = await prisma.messageLog.findUniqueOrThrow({
        where: { id: messageLogId },
      });

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { goal: true },
      });

      let extraction: FoodExtractionResult;
      let transcription: string | undefined;

      // Route to appropriate processor based on media type
      if (mediaType === 'text') {
        if (!messageLog.rawContent) throw new Error('No text content');

        // Check for named meal pattern first (e.g., "meu café da manhã de sempre")
        const namedMeal = await habitsService.checkNamedMealPattern(
          userId,
          messageLog.rawContent,
        );

        if (namedMeal) {
          extraction = namedMeal;
          logger.info({ userId, messageLogId }, 'Named meal pattern matched');
        } else {
          extraction = await textProcessorService.extractFoodsFromText(
            messageLog.rawContent,
            userId,
            messageLog.createdAt,
          );
        }
      } else if (mediaType === 'audio') {
        if (!messageLog.mediaUrl) throw new Error('No audio URL');
        const audioBuffer = await whatsappApiClient
          .getMediaUrl(messageLog.mediaUrl)
          .then((url) => whatsappApiClient.downloadMedia(url))
          .then((ab) => Buffer.from(ab));

        const result = await audioProcessorService.processAudio(
          audioBuffer,
          'audio/ogg',
          userId,
          messageLog.createdAt,
        );
        extraction = result.extraction;
        transcription = result.transcription;
      } else if (mediaType === 'image') {
        if (!messageLog.mediaUrl) throw new Error('No image URL');
        const imageBuffer = await whatsappApiClient
          .getMediaUrl(messageLog.mediaUrl)
          .then((url) => whatsappApiClient.downloadMedia(url))
          .then((ab) => Buffer.from(ab));

        const imageBase64 = imageBuffer.toString('base64');
        extraction = await imageProcessorService.processImage(
          imageBase64,
          'image/jpeg',
          messageLog.rawContent ?? undefined,
          userId,
          messageLog.createdAt,
        );
      } else {
        throw new Error(`Unsupported media type: ${mediaType}`);
      }

      if (extraction.foods.length === 0) {
        await this.sendNoFoodFoundResponse(user.phone, messageLogId);
        return;
      }

      // Enrich with nutritional database when possible
      const enrichedFoods = await nutritionService.enrichWithDatabase(extraction.foods);

      // Create meal record
      const mealDate = new Date(messageLog.createdAt);
      mealDate.setHours(0, 0, 0, 0);

      const totalCalories = enrichedFoods.reduce((s, f) => s + f.estimatedCalories, 0);
      const totalProtein = enrichedFoods.reduce((s, f) => s + f.protein, 0);
      const totalCarbs = enrichedFoods.reduce((s, f) => s + f.carbs, 0);
      const totalFat = enrichedFoods.reduce((s, f) => s + f.fat, 0);
      const totalFiber = enrichedFoods.reduce((s, f) => s + f.fiber, 0);

      const meal = await prisma.meal.create({
        data: {
          userId,
          date: mealDate,
          mealType: extraction.mealType as MealType,
          totalCalories,
          totalProtein,
          totalCarbs,
          totalFat,
          totalFiber,
          sourceType: mediaType.toUpperCase() as 'TEXT' | 'AUDIO' | 'IMAGE',
          messageLogId,
          items: {
            create: enrichedFoods.map((food) => ({
              foodName: food.name,
              quantity: food.quantity,
              unit: food.unit,
              calories: food.estimatedCalories,
              protein: food.protein,
              carbs: food.carbs,
              fat: food.fat,
              fiber: food.fiber,
              confidenceScore: food.confidenceScore,
              source: food.confidenceScore >= 0.9
                ? NutritionSource.NUTRITIONAL_DB
                : NutritionSource.AI_ESTIMATED,
            })),
          },
        },
      });

      // Update daily summary
      await updateDailySummaryQueue.add('update', {
        userId,
        date: mealDate.toISOString().split('T')[0],
      });

      // Generate user embedding for meal
      await generateEmbeddingQueue.add('embed', {
        userId,
        content: extraction.foods.map((f) => `${f.quantity}${f.unit} ${f.name}`).join(', '),
        type: 'MEAL_DESCRIPTION',
        metadata: { mealId: meal.id },
      });

      // Update user habits
      await habitsService.recordMealHabits(userId, extraction, messageLog.createdAt);

      // Get daily summary for response
      const dailySummary = await nutritionService.getDailySummary(
        userId,
        mealDate.toISOString().split('T')[0],
      );

      // Generate feedback message
      const mealSummary = enrichedFoods
        .map((f) => `${f.name} (${f.quantity}${f.unit})`)
        .join(', ');

      let responseText: string;

      if (extraction.needsConfirmation) {
        // Ask for confirmation with buttons
        await sendWhatsAppQueue.add('send', {
          to: user.phone,
          text:
            `🤔 *Confirme sua refeição:*\n\n` +
            enrichedFoods.map((f) => `• ${f.quantity}${f.unit} ${f.name} – ${f.estimatedCalories.toFixed(0)} kcal`).join('\n') +
            `\n\n📊 Total: ${totalCalories.toFixed(0)} kcal | P: ${totalProtein.toFixed(0)}g | C: ${totalCarbs.toFixed(0)}g | G: ${totalFat.toFixed(0)}g\n\n` +
            (extraction.confirmationMessage ?? 'Está correto?'),
          messageLogId,
        });
        responseText = `Confirmação solicitada para refeição ${mealSummary}`;
      } else {
        responseText = await textProcessorService.generateFeedbackMessage({
          userId,
          mealSummary,
          consumedToday: {
            calories: dailySummary.totalCalories,
            protein: dailySummary.totalProtein,
            carbs: dailySummary.totalCarbs,
            fat: dailySummary.totalFat,
          },
          goal: {
            calories: user.goal?.caloriesPerDay ?? 2000,
            protein: user.goal?.proteinPerDay ?? 50,
            carbs: user.goal?.carbsPerDay ?? 250,
            fat: user.goal?.fatPerDay ?? 65,
          },
        });

        await sendWhatsAppQueue.add('send', {
          to: user.phone,
          text: responseText,
          messageLogId,
        });
      }

      // Update message log
      const processingMs = Date.now() - startTime;
      await prisma.messageLog.update({
        where: { id: messageLogId },
        data: {
          processingStatus: ProcessingStatus.COMPLETED,
          transcription,
          responseText,
          processingMs,
          confidenceScore:
            enrichedFoods.reduce((s, f) => s + f.confidenceScore, 0) / enrichedFoods.length,
        },
      });

      logger.info(
        { userId, messageLogId, mealId: meal.id, processingMs },
        'Message processing completed',
      );
    } catch (err) {
      const processingMs = Date.now() - startTime;
      await prisma.messageLog.update({
        where: { id: messageLogId },
        data: {
          processingStatus: ProcessingStatus.FAILED,
          processingError: err instanceof Error ? err.message : 'Unknown error',
          processingMs,
        },
      });

      // Send error message to user
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await sendWhatsAppQueue.add('send', {
          to: user.phone,
          text: '😔 Desculpe, não consegui processar sua mensagem. Tente novamente ou descreva sua refeição de forma mais detalhada.',
        });
      }

      throw err;
    }
  },

  async sendNoFoodFoundResponse(phone: string, messageLogId: string): Promise<void> {
    await sendWhatsAppQueue.add('send', {
      to: phone,
      text:
        '🤷 Não identifiquei alimentos na sua mensagem.\n\n' +
        'Tente descrever assim:\n' +
        '• "almocei arroz, feijão e frango grelhado"\n' +
        '• "café com leite e 2 pães"\n' +
        '• Envie uma foto do prato',
      messageLogId,
    });
  },
};
