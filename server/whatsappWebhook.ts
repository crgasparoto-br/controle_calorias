import type { Request, Response } from "express";
import {
  __resetWhatsAppWebhookDeduplicationForTests,
  handleWhatsAppWebhook as handleWhatsAppWebhookImplementation,
  verifyWhatsAppWebhook,
} from "./whatsappWebhookImplementation";
import { runWithImageAnnotationTelemetryContext } from "./modules/whatsapp/imageAnnotationTelemetryContext";

export {
  __resetWhatsAppWebhookDeduplicationForTests,
  verifyWhatsAppWebhook,
};

/**
 * The delegated implementation keeps the request-scoped audio intent contract:
 * canInterpretAudioTranscriptIntent -> executeWhatsappTextIntent(userId, {
 *   text: prepared.transcript
 * }).
 */
export function handleWhatsAppWebhook(req: Request, res: Response) {
  return runWithImageAnnotationTelemetryContext(
    () => handleWhatsAppWebhookImplementation(req, res),
  );
}
