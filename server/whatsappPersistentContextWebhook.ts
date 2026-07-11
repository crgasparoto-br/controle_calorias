import type { Request, Response } from "express";
import { handleWhatsAppWebhookWithImageIdempotency } from "./whatsappImageIdempotencyWebhook";
import { extractIndexedWhatsAppWebhookMessages } from "./modules/whatsapp/webhookUtils";
import {
  enrichInboundMessage,
  runWithMessageLifecycleRequestScope,
} from "./modules/whatsapp/messageLifecycle";
import { withWhatsAppMediaPersistenceCorrelations } from "./modules/whatsapp/mediaPersistenceCorrelation";

function buildMediaCorrelations(payload: unknown) {
  return extractIndexedWhatsAppWebhookMessages(payload).flatMap(({ message }) => {
    if (!message.id) return [];

    return ([
      ...(message.image?.id ? ["image" as const] : []),
      ...(message.audio?.id ? ["audio" as const] : []),
    ]).map(mediaType => ({
      mediaType,
      externalMessageId: message.id as string,
      onStored: async (stored: { externalMessageId: string; storageKey: string; mimeType: string }) => {
        await enrichInboundMessage(stored.externalMessageId, {
          mediaStorageKey: stored.storageKey,
          mediaMimeType: stored.mimeType,
          allowRawContentStorage: true,
        });
      },
    }));
  });
}

/** Entry point HTTP canônico: correlação de mídia + claim persistente + roteadores reais. */
export async function handleWhatsAppPersistentContextWebhook(req: Request, res: Response) {
  const correlations = buildMediaCorrelations(req.body);
  return runWithMessageLifecycleRequestScope(() =>
    withWhatsAppMediaPersistenceCorrelations(correlations, () =>
      handleWhatsAppWebhookWithImageIdempotency(req, res),
    ),
  );
}
