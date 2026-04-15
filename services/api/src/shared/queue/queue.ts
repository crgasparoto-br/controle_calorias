import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { config } from '../../config';
import { logger } from '../logger/logger';

const connection = {
  host: new URL(config.redisUrl).hostname,
  port: parseInt(new URL(config.redisUrl).port || '6379'),
};

// Queue names
export const QUEUE_NAMES = {
  PROCESS_MESSAGE: 'process-message',
  SEND_WHATSAPP: 'send-whatsapp',
  UPDATE_DAILY_SUMMARY: 'update-daily-summary',
  GENERATE_EMBEDDING: 'generate-embedding',
  AUDIT_LOG: 'audit-log',
} as const;

// Job payloads
export interface ProcessMessageJob {
  messageLogId: string;
  userId: string;
  mediaType: string;
}

export interface SendWhatsAppJob {
  to: string;
  text: string;
  messageLogId?: string;
}

export interface UpdateDailySummaryJob {
  userId: string;
  date: string;
}

export interface GenerateEmbeddingJob {
  userId: string;
  content: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogJob {
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

// Queues
export const processMessageQueue = new Queue<ProcessMessageJob>(
  QUEUE_NAMES.PROCESS_MESSAGE,
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } },
);

export const sendWhatsAppQueue = new Queue<SendWhatsAppJob>(
  QUEUE_NAMES.SEND_WHATSAPP,
  { connection, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 500 } } },
);

export const updateDailySummaryQueue = new Queue<UpdateDailySummaryJob>(
  QUEUE_NAMES.UPDATE_DAILY_SUMMARY,
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 2000 } } },
);

export const generateEmbeddingQueue = new Queue<GenerateEmbeddingJob>(
  QUEUE_NAMES.GENERATE_EMBEDDING,
  { connection, defaultJobOptions: { attempts: 2 } },
);

export const auditLogQueue = new Queue<AuditLogJob>(
  QUEUE_NAMES.AUDIT_LOG,
  { connection, defaultJobOptions: { attempts: 1 } },
);

// Generic worker factory
export function createWorker<T>(
  queueName: string,
  processor: (job: Job<T>) => Promise<void>,
  concurrency = 5,
): Worker<T> {
  const worker = new Worker<T>(queueName, processor, {
    connection,
    concurrency,
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, queue: queueName }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, queue: queueName, err }, 'Job failed');
  });

  return worker;
}
