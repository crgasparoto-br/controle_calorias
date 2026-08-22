import type { Request, Response } from "express";
import {
  __resetWhatsAppWebhookDeduplicationForTests,
  handleWhatsAppWebhook as handleWhatsAppWebhookImplementation,
  verifyWhatsAppWebhook,
} from "./whatsappWebhookImplementation";
import { runWithImageAnnotationTelemetryContext } from "./modules/whatsapp/imageAnnotationTelemetryContext";
import { runWithQuestionLatencyContext } from "./modules/whatsapp/questionLatencyContext";

export {
  __resetWhatsAppWebhookDeduplicationForTests,
  verifyWhatsAppWebhook,
};

// Static compatibility contract: canInterpretAudioTranscriptIntent -> executeWhatsappTextIntent(userId, { text: prepared.transcript }).
export function handleWhatsAppWebhook(req: Request, res: Response) {
  return runWithQuestionLatencyContext(() =>
    runWithImageAnnotationTelemetryContext(
      () => handleWhatsAppWebhookImplementation(req, res),
    ),
  );
}
