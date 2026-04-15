import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../config';
import { logger } from '../../shared/logger/logger';
import { whatsappService } from './whatsapp.service';
import { whatsappWebhookPayloadSchema } from './whatsapp.types';
import { whatsappMessagesReceived } from '../../shared/metrics/metrics';

export const whatsappRoutes = async (fastify: FastifyInstance): Promise<void> => {
  /**
   * GET /webhook/whatsapp
   * WhatsApp webhook verification (challenge)
   */
  fastify.get(
    '/whatsapp',
    async (
      request: FastifyRequest<{
        Querystring: {
          'hub.mode': string;
          'hub.verify_token': string;
          'hub.challenge': string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const mode = request.query['hub.mode'];
      const token = request.query['hub.verify_token'];
      const challenge = request.query['hub.challenge'];

      if (mode === 'subscribe' && token === config.whatsappWebhookVerifyToken) {
        logger.info('WhatsApp webhook verified');
        return reply.status(200).send(challenge);
      }

      logger.warn({ mode, token }, 'WhatsApp webhook verification failed');
      return reply.status(403).send({ error: 'Verification failed' });
    },
  );

  /**
   * POST /webhook/whatsapp
   * Receive WhatsApp messages
   */
  fastify.post(
    '/whatsapp',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Always respond 200 quickly to WhatsApp (otherwise it will retry)
      reply.status(200).send({ status: 'ok' });

      const parsed = whatsappWebhookPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        logger.warn({ errors: parsed.error.issues, body: request.body }, 'Invalid webhook payload');
        return;
      }

      const payload = parsed.data;

      // Count metrics
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          const messages = change.value.messages ?? [];
          for (const msg of messages) {
            whatsappMessagesReceived.inc({ media_type: msg.type });
          }
        }
      }

      // Process asynchronously (don't await to keep 200 response fast)
      whatsappService.handleWebhook(payload).catch((err) => {
        logger.error({ err }, 'Error handling WhatsApp webhook');
      });
    },
  );
};
