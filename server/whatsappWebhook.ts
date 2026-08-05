import type { Request, Response } from "express";
import {
  __resetWhatsAppWebhookDeduplicationForTests,
  handleWhatsAppWebhook as handleLegacyWhatsAppWebhook,
  verifyWhatsAppWebhook,
} from "./whatsappWebhookLegacy";
import { extractWhatsAppWebhookMessages } from "./modules/whatsapp/webhookUtils";

export {
  __resetWhatsAppWebhookDeduplicationForTests,
  verifyWhatsAppWebhook,
};

const activeImageRoutingRequests = new WeakSet<object>();

/**
 * Canonical compatibility facade. Image-bearing messages always pass through
 * the structured annotation router before the legacy non-image handler.
 * Re-entry from that router falls through to the legacy handler exactly once.
 */
export async function handleWhatsAppWebhook(req: Request, res: Response) {
  const hasImage = extractWhatsAppWebhookMessages(req.body)
    .some(message => Boolean(message.image?.id));

  if (hasImage && !activeImageRoutingRequests.has(req)) {
    activeImageRoutingRequests.add(req);
    try {
      const { handleWhatsAppWebhookWithAnnotatedImages } = await import(
        "./whatsappAnnotatedImageWebhook"
      );
      return await handleWhatsAppWebhookWithAnnotatedImages(req, res);
    } finally {
      activeImageRoutingRequests.delete(req);
    }
  }

  return handleLegacyWhatsAppWebhook(req, res);
}
