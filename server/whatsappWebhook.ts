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

/**
 * Canonical compatibility facade. Image-bearing messages always pass through
 * the structured annotation router before the legacy non-image handler.
 */
export async function handleWhatsAppWebhook(req: Request, res: Response) {
  const hasImage = extractWhatsAppWebhookMessages(req.body)
    .some(message => Boolean(message.image?.id));

  if (hasImage) {
    const { handleWhatsAppWebhookWithAnnotatedImages } = await import(
      "./whatsappAnnotatedImageWebhook"
    );
    return handleWhatsAppWebhookWithAnnotatedImages(req, res);
  }

  return handleLegacyWhatsAppWebhook(req, res);
}
