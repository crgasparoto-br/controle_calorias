import type { Request, Response } from "express";
import { handleWhatsAppWebhookWithImageIdempotency } from "./whatsappImageIdempotencyWebhook";
import { gateSuspendedWhatsAppWrites } from "./whatsappBillingWriteGate";
import { extractIndexedWhatsAppWebhookMessages } from "./modules/whatsapp/webhookUtils";
import {
  enrichInboundMessage,
  runWithMessageLifecycleRequestScope,
} from "./modules/whatsapp/messageLifecycle";
import { withStoragePersistenceCorrelations } from "./storagePersistenceCorrelation";
import { runWithWhatsAppTimeZoneRequestScope } from "./modules/whatsapp/timeZoneContext";

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

/** Entry point HTTP canônico: gate comercial + correlação de mídia + claim persistente + roteadores reais. */
export async function handleWhatsAppPersistentContextWebhook(req: Request, res: Response) {
  return runWithMessageLifecycleRequestScope(() =>
    runWithWhatsAppTimeZoneRequestScope(async () => {
      const gated = await gateSuspendedWhatsAppWrites(req.body);
      if (gated.handledCount > 0) req.body = gated.remainingPayload;

      const remainingMessages = extractIndexedWhatsAppWebhookMessages(req.body);
      if (remainingMessages.length === 0) {
        return res.status(200).json({ ok: true, processed: gated.handledCount });
      }

      const correlations = buildMediaCorrelations(req.body);
      return withStoragePersistenceCorrelations(correlations, () =>
        handleWhatsAppWebhookWithImageIdempotency(req, res),
      );
    }),
  );
}
