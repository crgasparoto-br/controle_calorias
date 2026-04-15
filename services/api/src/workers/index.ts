import { createWorker, QUEUE_NAMES } from '../shared/queue/queue';
import { aiProcessorService } from '../modules/ai/ai-processor.service';
import { whatsappApiClient } from '../modules/whatsapp/whatsapp-api.client';
import { nutritionService } from '../modules/nutrition/nutrition.service';
import { embeddingService } from '../modules/ai/embedding.service';
import { prisma } from '../shared/database/prisma';
import { logger } from '../shared/logger/logger';
import type {
  ProcessMessageJob,
  SendWhatsAppJob,
  UpdateDailySummaryJob,
  GenerateEmbeddingJob,
  AuditLogJob,
} from '../shared/queue/queue';
import type { Job } from 'bullmq';
import type { EmbeddingType, Prisma } from '@prisma/client';

export function startWorkers(): void {
  // Process incoming WhatsApp messages (AI pipeline)
  createWorker<ProcessMessageJob>(
    QUEUE_NAMES.PROCESS_MESSAGE,
    async (job: Job<ProcessMessageJob>) => {
      await aiProcessorService.processMessage(
        job.data.messageLogId,
        job.data.userId,
        job.data.mediaType,
      );
    },
    3, // concurrency
  );

  // Send WhatsApp text messages
  createWorker<SendWhatsAppJob>(
    QUEUE_NAMES.SEND_WHATSAPP,
    async (job: Job<SendWhatsAppJob>) => {
      await whatsappApiClient.sendText(job.data.to, job.data.text);
      if (job.data.messageLogId) {
        await prisma.messageLog.update({
          where: { id: job.data.messageLogId },
          data: { responseText: job.data.text },
        });
      }
    },
    5,
  );

  // Update daily nutritional summaries
  createWorker<UpdateDailySummaryJob>(
    QUEUE_NAMES.UPDATE_DAILY_SUMMARY,
    async (job: Job<UpdateDailySummaryJob>) => {
      await nutritionService.updateDailySummary(job.data.userId, job.data.date);
    },
    10,
  );

  // Generate and store embeddings
  createWorker<GenerateEmbeddingJob>(
    QUEUE_NAMES.GENERATE_EMBEDDING,
    async (job: Job<GenerateEmbeddingJob>) => {
      await embeddingService.storeUserEmbedding(
        job.data.userId,
        job.data.content,
        job.data.type as EmbeddingType,
        job.data.metadata,
      );
    },
    2,
  );

  // Write audit logs
  createWorker<AuditLogJob>(
    QUEUE_NAMES.AUDIT_LOG,
    async (job: Job<AuditLogJob>) => {
      await prisma.auditLog.create({
        data: {
          userId: job.data.userId,
          action: job.data.action,
          entity: job.data.entity,
          entityId: job.data.entityId,
          data: job.data.data as Prisma.InputJsonValue | undefined,
        },
      });
    },
    10,
  );

  logger.info('✅ Queue workers started');
}
