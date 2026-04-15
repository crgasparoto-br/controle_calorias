import { config } from '../../config';
import { logger } from '../../shared/logger/logger';
import type { SendTextMessage, SendInteractiveMessage } from './whatsapp.types';

const BASE_URL = `https://graph.facebook.com/${config.whatsappApiVersion}`;

async function callWhatsAppApi<T>(
  endpoint: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<T> {
  const url = `${BASE_URL}/${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.whatsappAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${error}`);
  }

  return response.json() as Promise<T>;
}

export const whatsappApiClient = {
  /**
   * Send a plain text message to a WhatsApp user
   */
  async sendText(to: string, text: string): Promise<{ messages: Array<{ id: string }> }> {
    const payload: SendTextMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    };
    return callWhatsAppApi(
      `${config.whatsappPhoneNumberId}/messages`,
      'POST',
      payload,
    );
  },

  /**
   * Send interactive button message (for confirmations)
   */
  async sendButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<{ messages: Array<{ id: string }> }> {
    const payload: SendInteractiveMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.map((b) => ({
            type: 'reply' as const,
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    };
    return callWhatsAppApi(
      `${config.whatsappPhoneNumberId}/messages`,
      'POST',
      payload,
    );
  },

  /**
   * Download media file (audio or image) from WhatsApp servers
   */
  async getMediaUrl(mediaId: string): Promise<string> {
    const response = await callWhatsAppApi<{ url: string; mime_type: string }>(
      mediaId,
      'GET',
    );
    return response.url;
  },

  /**
   * Download media binary content
   */
  async downloadMedia(mediaUrl: string): Promise<ArrayBuffer> {
    const response = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${config.whatsappAccessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status}`);
    }
    return response.arrayBuffer();
  },

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await callWhatsAppApi(
      `${config.whatsappPhoneNumberId}/messages`,
      'POST',
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
    );
  },
};
