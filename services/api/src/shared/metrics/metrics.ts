import { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Registry, Counter, Histogram } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register });

// Custom metrics
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

export const whatsappMessagesReceived = new Counter({
  name: 'whatsapp_messages_received_total',
  help: 'Total WhatsApp messages received',
  labelNames: ['media_type'],
  registers: [register],
});

export const mealsLogged = new Counter({
  name: 'meals_logged_total',
  help: 'Total meals logged by users',
  labelNames: ['meal_type', 'source'],
  registers: [register],
});

export const aiProcessingDuration = new Histogram({
  name: 'ai_processing_duration_seconds',
  help: 'Duration of AI processing operations',
  labelNames: ['operation', 'model'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const metricsRoute = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get('/', async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
};
