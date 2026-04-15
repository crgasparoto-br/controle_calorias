import { z } from 'zod';

// WhatsApp Cloud API webhook payload schemas
export const whatsappContactSchema = z.object({
  profile: z.object({ name: z.string() }),
  wa_id: z.string(),
});

export const whatsappTextMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.literal('text'),
  text: z.object({ body: z.string() }),
});

export const whatsappAudioMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.literal('audio'),
  audio: z.object({
    id: z.string(),
    mime_type: z.string(),
  }),
});

export const whatsappImageMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.literal('image'),
  image: z.object({
    id: z.string(),
    mime_type: z.string(),
    caption: z.string().optional(),
  }),
});

export const whatsappInteractiveMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.literal('interactive'),
  interactive: z.object({
    type: z.enum(['button_reply', 'list_reply']),
    button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
  }),
});

export const whatsappMessageSchema = z.discriminatedUnion('type', [
  whatsappTextMessageSchema,
  whatsappAudioMessageSchema,
  whatsappImageMessageSchema,
  whatsappInteractiveMessageSchema,
]);

export const whatsappWebhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.literal('whatsapp'),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            contacts: z.array(whatsappContactSchema).optional(),
            messages: z.array(whatsappMessageSchema).optional(),
            statuses: z.array(z.any()).optional(),
          }),
          field: z.literal('messages'),
        }),
      ),
    }),
  ),
});

export type WhatsAppWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;
export type WhatsAppMessage = z.infer<typeof whatsappMessageSchema>;

// Outbound message types for WhatsApp Cloud API
export interface SendTextMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

export interface SendInteractiveMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button';
    body: { text: string };
    action: {
      buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
    };
  };
}
