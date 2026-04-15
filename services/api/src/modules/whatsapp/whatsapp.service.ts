import { prisma } from '../../shared/database/prisma';
import { logger } from '../../shared/logger/logger';
import { processMessageQueue, sendWhatsAppQueue } from '../../shared/queue/queue';
import { whatsappApiClient } from './whatsapp-api.client';
import { usersService } from '../users/users.service';
import type { WhatsAppMessage, WhatsAppWebhookPayload } from './whatsapp.types';
import { MessageMediaType, ProcessingStatus } from '@prisma/client';

export const whatsappService = {
  /**
   * Process an incoming WhatsApp webhook payload
   */
  async handleWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const { messages, contacts } = change.value;

        if (!messages || messages.length === 0) continue;

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          const contact = contacts?.[i];

          try {
            await this.processIncomingMessage(message, contact?.profile?.name);
          } catch (err) {
            logger.error({ err, messageId: message.id }, 'Error processing incoming message');
          }
        }
      }
    }
  },

  /**
   * Process a single incoming message
   */
  async processIncomingMessage(
    message: WhatsAppMessage,
    contactName?: string,
  ): Promise<void> {
    const phone = message.from;

    // Upsert user by phone number
    const user = await usersService.findOrCreateByPhone(phone, contactName);

    // Determine media type
    const mediaType = this.getMediaType(message.type);

    // Get content info
    const rawContent =
      message.type === 'text'
        ? message.text.body
        : message.type === 'interactive'
          ? message.interactive.button_reply?.id ?? message.interactive.list_reply?.id
          : undefined;

    const mediaId =
      message.type === 'audio'
        ? message.audio.id
        : message.type === 'image'
          ? message.image.id
          : undefined;

    const caption =
      message.type === 'image' ? message.image.caption : undefined;

    // Create message log
    const messageLog = await prisma.messageLog.create({
      data: {
        userId: user.id,
        whatsappMessageId: message.id,
        direction: 'INBOUND',
        mediaType,
        rawContent: rawContent ?? caption,
        processingStatus: ProcessingStatus.PENDING,
      },
    });

    // Mark message as read
    await whatsappApiClient.markAsRead(message.id).catch((err) =>
      logger.warn({ err, messageId: message.id }, 'Failed to mark message as read'),
    );

    // Handle interactive confirmations immediately
    if (message.type === 'interactive') {
      await this.handleInteractiveMessage(user.id, message, messageLog.id);
      return;
    }

    // Handle onboarding if not completed
    if (!user.onboardingCompleted) {
      await this.handleOnboarding(user, phone, messageLog.id, rawContent);
      return;
    }

    // Enqueue async processing
    await processMessageQueue.add('process', {
      messageLogId: messageLog.id,
      userId: user.id,
      mediaType: message.type,
    });

    logger.info(
      { messageLogId: messageLog.id, userId: user.id, mediaType },
      'Message enqueued for processing',
    );
  },

  /**
   * Handle interactive button/list replies (confirmations)
   */
  async handleInteractiveMessage(
    userId: string,
    message: WhatsAppMessage,
    messageLogId: string,
  ): Promise<void> {
    if (message.type !== 'interactive') return;

    const replyId =
      message.interactive.button_reply?.id ??
      message.interactive.list_reply?.id;

    if (!replyId) return;

    // Parse reply: format is "action:entityId"
    const [action, entityId] = replyId.split(':');

    if (action === 'confirm_meal' && entityId) {
      await prisma.meal.update({
        where: { id: entityId },
        data: { confirmedByUser: true },
      });

      await sendWhatsAppQueue.add('send', {
        to: message.from,
        text: '✅ Refeição confirmada! Continue assim! 💪',
        messageLogId,
      });
    } else if (action === 'cancel_meal' && entityId) {
      await prisma.meal.delete({ where: { id: entityId } });

      await sendWhatsAppQueue.add('send', {
        to: message.from,
        text: '❌ Refeição cancelada. Envie novamente quando quiser registrar.',
        messageLogId,
      });
    }

    await prisma.messageLog.update({
      where: { id: messageLogId },
      data: { processingStatus: ProcessingStatus.COMPLETED },
    });
  },

  /**
   * Handle user onboarding flow
   */
  async handleOnboarding(
    user: { id: string; name?: string | null },
    phone: string,
    messageLogId: string,
    content?: string,
  ): Promise<void> {
    const welcomeMessage =
      `👋 Olá${user.name ? `, ${user.name}` : ''}! Seja bem-vindo(a) ao *Controle Calorias*! 🥗\n\n` +
      `Sou seu assistente nutricional no WhatsApp.\n\n` +
      `Para começar, me diga sua *meta diária de calorias* (ex: _2000 kcal_) ` +
      `ou envie *"configurar perfil"* para configurarmos juntos.\n\n` +
      `Você pode me enviar:\n` +
      `📝 *Texto* - "almocei arroz, feijão e frango"\n` +
      `🎤 *Áudio* - descrevendo sua refeição\n` +
      `📷 *Foto* - do prato ou rótulo do alimento`;

    await sendWhatsAppQueue.add('send', {
      to: phone,
      text: welcomeMessage,
      messageLogId,
    });

    await prisma.messageLog.update({
      where: { id: messageLogId },
      data: { processingStatus: ProcessingStatus.COMPLETED, responseText: welcomeMessage },
    });
  },

  getMediaType(type: string): MessageMediaType {
    const map: Record<string, MessageMediaType> = {
      text: MessageMediaType.TEXT,
      audio: MessageMediaType.AUDIO,
      image: MessageMediaType.IMAGE,
      document: MessageMediaType.DOCUMENT,
    };
    return map[type] ?? MessageMediaType.TEXT;
  },
};
